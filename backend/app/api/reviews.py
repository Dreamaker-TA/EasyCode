""" 评测重试 endpoint。"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.problem import ErrorDetail, ErrorResponse
from app.schemas.submission import SubmissionDetail
from app.services import submission_service

router = APIRouter(prefix="/submissions", tags=["reviews"])


def _err(code: str, msg: str, status_code: int) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail=ErrorResponse(
            error=ErrorDetail(code=code, message=msg)
        ).model_dump(),
    )


@router.post("/{submission_id}/review", response_model=SubmissionDetail)
def retry_review(
    submission_id: str,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
) -> SubmissionDetail:
    """重新评测：与 finalize 同一异步状态机。

    置 status=reviewing + reviewed_at=None 立即返回，后台共用 ``run_review_pipeline``
    重跑评测 + SRS（对同一 submission 的重评由 ``_refresh_schedule`` 冻结 prior 保证幂等）。
    允许重评 ``submitted``（换评级）与 ``review_failed``（降级恢复）。
    """
    try:
        submission_service.retry_review(db, submission_id)
    except LookupError:
        raise _err("SUBMISSION_NOT_FOUND", f"submission {submission_id} not found", 404)
    except ValueError:
        raise _err(
            "SUBMISSION_NOT_FINAL",
            "only submitted or review_failed submissions can be re-reviewed",
            409,
        )

    background.add_task(submission_service.run_review_pipeline, submission_id)

    detail = submission_service.get_detail(db, submission_id)
    assert detail is not None
    return SubmissionDetail(**detail)
