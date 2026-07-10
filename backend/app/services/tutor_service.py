"""对话式苏格拉底助教服务。"""

from __future__ import annotations

import json
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Problem, Snapshot, Submission, TutorMessage
from app.schemas.tutor import (
    TutorMessagePostResponse,
    TutorMessagePublic,
)
from app.services.llm_client import LLMNotConfigured, LLMUnavailable, get_client
from app.services.llm_review import (
    _reference_for,
    _render,
    _render_timeline,
    _system_prompt,
)

_DEFAULT_HELP_QUESTION = "（没有具体问题，请综合判断当前卡点。）"
_MAX_CONVERSATION_MESSAGES = 8
_MAX_RECENT_SNAPSHOTS = 5


@dataclass
class _PreparedTutorCall:
    sub: Submission
    problem: Problem
    student: TutorMessage
    tier_before: int
    system: str
    user: str


def get_conversation(db: Session, submission_id: str) -> list[TutorMessage]:
    _require_submission(db, submission_id)
    return list(
        db.execute(
            select(TutorMessage)
            .where(TutorMessage.submission_id == submission_id)
            .order_by(TutorMessage.created_at.asc(), TutorMessage.id.asc())
        )
        .scalars()
        .all()
    )


def post_tutor_message(
    db: Session,
    submission_id: str,
    content: str,
    *,
    current_code: str | None = None,
) -> TutorMessagePostResponse:
    prepared = _prepare_tutor_call(db, submission_id, content, current_code=current_code)
    try:
        text = get_client().chat_text(
            system=prepared.system,
            user=prepared.user,
            temperature=0.4,
            max_tokens=800,
        )
        return _persist_tutor_reply(db, prepared, text)
    except Exception:
        db.rollback()
        raise


def stream_tutor_message_events(
    db: Session,
    submission_id: str,
    content: str,
    *,
    current_code: str | None = None,
) -> Iterator[dict[str, Any]]:
    prepared: _PreparedTutorCall | None = None
    try:
        prepared = _prepare_tutor_call(db, submission_id, content, current_code=current_code)
        chunks = get_client().chat_text_stream(
            system=prepared.system,
            user=prepared.user,
            temperature=0.4,
            max_tokens=800,
        )

        collected: list[str] = []
        for chunk in chunks:
            collected.append(chunk)
            yield {"event": "delta", "data": {"delta": chunk}}

        text = "".join(collected).strip()
        response = _persist_tutor_reply(db, prepared, text)
        yield {"event": "message", "data": response.model_dump(mode="json")}
    except LLMNotConfigured as exc:
        db.rollback()
        yield {
            "event": "error",
            "data": {
                "code": "LLM_NOT_CONFIGURED",
                "message": str(exc),
            },
        }
    except LLMUnavailable as exc:
        db.rollback()
        yield {
            "event": "error",
            "data": {
                "code": "LLM_UNAVAILABLE",
                "message": str(exc),
            },
        }
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        code = "SUBMISSION_NOT_FOUND" if prepared is None else "TUTOR_STREAM_FAILED"
        yield {
            "event": "error",
            "data": {
                "code": code,
                "message": str(exc) or "Tutor stream failed",
            },
        }


def _prepare_tutor_call(
    db: Session,
    submission_id: str,
    content: str,
    *,
    current_code: str | None,
) -> _PreparedTutorCall:
    sub = _require_submission(db, submission_id)
    problem = db.get(Problem, sub.problem_id)
    if problem is None:
        raise LookupError(f"problem {sub.problem_id} not found")

    tier_before = sub.hint_tier_reached or 0
    student = TutorMessage(
        submission_id=submission_id,
        role="student",
        content=content.strip() or _DEFAULT_HELP_QUESTION,
        tier_at=tier_before,
    )
    db.add(student)
    db.flush()

    language = sub.language or "python"
    prompt_code = current_code if current_code is not None else _latest_code_context(db, sub)
    recent_timeline = _recent_timeline(db, submission_id)
    conversation = _recent_conversation(db, submission_id)
    reference_solution_md = _reference_for(problem, language)
    system = (
        _system_prompt("help_system.md")
        + "\n\n## 本题参考解（仅供助教内部校验；不得复制到回答里）\n\n"
        + reference_solution_md
    )
    user = _render(
        "help_user.j2",
        problem=problem,
        language=language,
        current_code=prompt_code or "(empty)",
        recent=recent_timeline,
        conversation=conversation,
        current_tier=tier_before,
        user_question=student.content,
    )
    return _PreparedTutorCall(
        sub=sub,
        problem=problem,
        student=student,
        tier_before=tier_before,
        system=system,
        user=user,
    )


def _persist_tutor_reply(
    db: Session,
    prepared: _PreparedTutorCall,
    text: str,
) -> TutorMessagePostResponse:
    tier_after = min(prepared.tier_before + 1, 4)
    reply = TutorMessage(
        submission_id=prepared.sub.id,
        role="tutor",
        content=text.strip(),
        tier_at=tier_after,
    )
    db.add(reply)
    prepared.sub.hint_tier_reached = tier_after
    db.commit()
    db.refresh(reply)
    return TutorMessagePostResponse(
        message=TutorMessagePublic.model_validate(reply),
        tier_before=prepared.tier_before,
        tier_after=tier_after,
    )


def _require_submission(db: Session, submission_id: str) -> Submission:
    sub = db.get(Submission, submission_id)
    if sub is None:
        raise LookupError(f"submission {submission_id} not found")
    return sub


def _latest_code_context(db: Session, sub: Submission) -> str:
    latest = (
        db.execute(
            select(Snapshot)
            .where(Snapshot.submission_id == sub.id, Snapshot.kind == "code")
            .order_by(Snapshot.t_offset_sec.desc(), Snapshot.id.desc())
            .limit(1)
        )
        .scalars()
        .first()
    )
    return latest.code if latest is not None else sub.code


def _recent_timeline(db: Session, submission_id: str) -> list[dict]:
    recent = (
        db.execute(
            select(Snapshot)
            .where(Snapshot.submission_id == submission_id, Snapshot.kind == "code")
            .order_by(Snapshot.t_offset_sec.desc(), Snapshot.id.desc())
            .limit(_MAX_RECENT_SNAPSHOTS)
        )
        .scalars()
        .all()
    )
    recent_nodes = [
        {
            "t_offset_sec": s.t_offset_sec,
            "code": s.code,
            "code_hash": s.code_hash,
            "kind": "code",
        }
        for s in reversed(recent)
    ]
    return _render_timeline(recent_nodes)


def _recent_conversation(db: Session, submission_id: str) -> list[TutorMessage]:
    newest = (
        db.execute(
            select(TutorMessage)
            .where(TutorMessage.submission_id == submission_id)
            .order_by(TutorMessage.created_at.desc(), TutorMessage.id.desc())
            .limit(_MAX_CONVERSATION_MESSAGES)
        )
        .scalars()
        .all()
    )
    return list(reversed(newest))


def encode_sse(event: dict[str, Any]) -> str:
    data = json.dumps(event["data"], ensure_ascii=False)
    return f"event: {event['event']}\ndata: {data}\n\n"
