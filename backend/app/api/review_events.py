"""SSE endpoint for review progress events."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import Submission
from app.schemas.problem import ErrorDetail, ErrorResponse
from app.services import review_progress

router = APIRouter(prefix="/submissions", tags=["reviews"])


def _not_found(submission_id: str) -> HTTPException:
    return HTTPException(
        status_code=404,
        detail=ErrorResponse(
            error=ErrorDetail(
                code="SUBMISSION_NOT_FOUND",
                message=f"submission {submission_id} not found",
            )
        ).model_dump(),
    )


def _encode_event(event: dict | None) -> str:
    if event is None:
        return ": keepalive\n\n"
    return f"event: stage\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"


async def _event_stream(
    submission_id: str, *, close_if_empty: bool
) -> AsyncIterator[str]:
    async for event in review_progress.subscribe(
        submission_id, close_if_empty=close_if_empty
    ):
        yield _encode_event(event)


@router.get("/{submission_id}/review/events")
def review_events(
    submission_id: str,
    db: Session = Depends(get_db),
) -> StreamingResponse:
    sub = db.get(Submission, submission_id)
    if sub is None:
        raise _not_found(submission_id)

    return StreamingResponse(
        _event_stream(submission_id, close_if_empty=sub.status != "reviewing"),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )
