"""对话式苏格拉底助教 API。"""

from __future__ import annotations

from collections.abc import Iterator

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import Submission
from app.schemas.problem import ErrorDetail, ErrorResponse
from app.schemas.tutor import (
    TutorMessageIn,
    TutorMessageListResponse,
    TutorMessagePostResponse,
    TutorMessagePublic,
)
from app.services import tutor_service
from app.services.llm_client import LLMNotConfigured, LLMUnavailable

router = APIRouter(prefix="/submissions", tags=["tutor"])


def _err(code: str, msg: str, status_code: int) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail=ErrorResponse(
            error=ErrorDetail(code=code, message=msg)
        ).model_dump(),
    )


@router.get("/{submission_id}/tutor/messages", response_model=TutorMessageListResponse)
def list_tutor_messages(
    submission_id: str,
    db: Session = Depends(get_db),
) -> TutorMessageListResponse:
    try:
        messages = tutor_service.get_conversation(db, submission_id)
    except LookupError:
        raise _err("SUBMISSION_NOT_FOUND", f"submission {submission_id} not found", 404)
    return TutorMessageListResponse(
        messages=[TutorMessagePublic.model_validate(m) for m in messages]
    )


@router.post("/{submission_id}/tutor/messages", response_model=TutorMessagePostResponse)
def post_tutor_message(
    submission_id: str,
    body: TutorMessageIn,
    request: Request,
    db: Session = Depends(get_db),
):
    sub = db.get(Submission, submission_id)
    if sub is None:
        raise _err("SUBMISSION_NOT_FOUND", f"submission {submission_id} not found", 404)

    accepts = request.headers.get("accept", "")
    if "text/event-stream" in accepts:
        return StreamingResponse(
            _event_stream(db, submission_id, body.content, body.current_code),
            media_type="text/event-stream",
        )

    try:
        return tutor_service.post_tutor_message(
            db,
            submission_id,
            body.content,
            current_code=body.current_code,
        )
    except LookupError:
        raise _err("SUBMISSION_NOT_FOUND", f"submission {submission_id} not found", 404)
    except LLMNotConfigured:
        raise _err(
            "LLM_NOT_CONFIGURED",
            "AI model access key is not configured; open settings diagnostics",
            503,
        )
    except LLMUnavailable:
        raise _err(
            "LLM_UNAVAILABLE",
            "AI model is temporarily unavailable; check settings or retry later",
            503,
        )


def _event_stream(
    db: Session,
    submission_id: str,
    content: str,
    current_code: str | None,
) -> Iterator[str]:
    for event in tutor_service.stream_tutor_message_events(
        db,
        submission_id,
        content,
        current_code=current_code,
    ):
        yield tutor_service.encode_sse(event)
