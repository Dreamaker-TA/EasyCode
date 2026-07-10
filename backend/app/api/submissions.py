"""提交 / 快照 API。

路径前缀 /api 由 main.py include_router 时统一加。
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import Submission
from app.schemas.problem import ErrorDetail, ErrorResponse
from app.schemas.submission import (
    BatchDeleteIn,
    BatchDeleteResult,
    SnapshotBatchIn,
    SnapshotBatchResult,
    SnapshotListResponse,
    SubmissionContinueResponse,
    SubmissionCreate,
    SubmissionDetail,
    SubmissionDraft,
    SubmissionFinalize,
)
from app.services import submission_service

router = APIRouter(prefix="/submissions", tags=["submissions"])


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


@router.post(
    "",
    response_model=SubmissionDraft,
    status_code=status.HTTP_201_CREATED,
    responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def create_submission(
    body: SubmissionCreate, db: Session = Depends(get_db)
) -> SubmissionDraft:
    try:
        sub = submission_service.create_draft(
            db,
            problem_id=body.problem_id,
            mode=body.mode,
            mode_limit_sec=body.mode_limit_sec,
            language=body.language,
        )
    except LookupError as e:
        # 题目不存在 → 404（语义不变）
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(
                error=ErrorDetail(code="PROBLEM_NOT_FOUND", message=str(e))
            ).model_dump(),
        )
    except ValueError as e:
        # 题目存在但请求语言无参考解 → 409，不可误报成 404 PROBLEM_NOT_FOUND。
        raise HTTPException(
            status_code=409,
            detail=ErrorResponse(
                error=ErrorDetail(code="LANGUAGE_NOT_SUPPORTED", message=str(e))
            ).model_dump(),
        )
    return SubmissionDraft.model_validate(sub)


@router.post(
    "/{submission_id}/snapshots",
    response_model=SnapshotBatchResult,
    responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def add_snapshots(
    submission_id: str,
    body: SnapshotBatchIn,
    db: Session = Depends(get_db),
) -> SnapshotBatchResult:
    sub = db.get(Submission, submission_id)
    if sub is None:
        raise _not_found(submission_id)
    if sub.status != "draft":
        raise HTTPException(
            status_code=409,
            detail=ErrorResponse(
                error=ErrorDetail(
                    code="SUBMISSION_FROZEN",
                    message="submission already finalized; no more snapshots accepted",
                )
            ).model_dump(),
        )
    accepted, duplicates = submission_service.add_snapshots(
        db,
        submission_id,
        [s.model_dump() for s in body.snapshots],
    )
    return SnapshotBatchResult(accepted=accepted, duplicates=duplicates)


@router.post(
    "/{submission_id}/finalize",
    response_model=SubmissionDetail,
    responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def finalize_submission(
    submission_id: str,
    body: SubmissionFinalize,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
) -> SubmissionDetail:
    """冻结提交后立即返回（status=reviewing），LLM 评测 + SRS 走后台。"""
    try:
        submission_service.finalize(
            db,
            submission_id,
            code=body.code,
            elapsed_sec=body.elapsed_sec,
            test_results=body.test_results.model_dump() if body.test_results else None,
        )
    except LookupError:
        raise _not_found(submission_id)
    except submission_service.TestResultsContractError as e:
        raise HTTPException(
            status_code=e.status_code,
            detail=ErrorResponse(
                error=ErrorDetail(code=e.code, message=str(e))
            ).model_dump(),
        )
    except ValueError as e:
        raise HTTPException(
            status_code=409,
            detail=ErrorResponse(
                error=ErrorDetail(code="SUBMISSION_ALREADY_SUBMITTED", message=str(e))
            ).model_dump(),
        )
    background.add_task(submission_service.run_review_pipeline, submission_id)
    detail = submission_service.get_detail(db, submission_id)
    assert detail is not None
    return SubmissionDetail(**detail)


_CONTINUE_REASON_CODE = {
    "not_submitted": ("SUBMISSION_NOT_SUBMITTED", "submission is not in submitted state"),
    "not_untimed": ("CONTINUE_NOT_UNTIMED", "only untimed submissions can be continued"),
    "rating_not_eligible": (
        "CONTINUE_RATING_NOT_ELIGIBLE",
        "only C/D rated submissions can be continued",
    ),
}


@router.post(
    "/{submission_id}/continue",
    response_model=SubmissionContinueResponse,
    responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def continue_submission(
    submission_id: str, db: Session = Depends(get_db)
) -> SubmissionContinueResponse:
    """从一次 C/D 评级 + untimed 的旧提交开启一次「续编」。"""
    try:
        new_sub, t_offset_resume = submission_service.continue_from(db, submission_id)
    except LookupError:
        raise _not_found(submission_id)
    except ValueError as e:
        code, message = _CONTINUE_REASON_CODE.get(
            str(e), ("CONTINUE_NOT_ALLOWED", str(e))
        )
        raise HTTPException(
            status_code=409,
            detail=ErrorResponse(
                error=ErrorDetail(code=code, message=message)
            ).model_dump(),
        )
    return SubmissionContinueResponse(
        submission=SubmissionDraft.model_validate(new_sub),
        t_offset_resume=t_offset_resume,
    )


@router.get(
    "/{submission_id}",
    response_model=SubmissionDetail,
    responses={404: {"model": ErrorResponse}},
)
def get_submission(submission_id: str, db: Session = Depends(get_db)) -> SubmissionDetail:
    detail = submission_service.get_detail(db, submission_id)
    if detail is None:
        raise _not_found(submission_id)
    return SubmissionDetail(**detail)


@router.get(
    "/{submission_id}/snapshots",
    response_model=SnapshotListResponse,
    responses={404: {"model": ErrorResponse}},
)
def get_submission_snapshots(
    submission_id: str, db: Session = Depends(get_db)
) -> SnapshotListResponse:
    """该提交的所有快照（升序）。。"""
    if db.get(Submission, submission_id) is None:
        raise _not_found(submission_id)
    items = submission_service.list_snapshots(db, submission_id)
    return SnapshotListResponse(submission_id=submission_id, items=items)


# === 删除（单条 / 批量） ===
# 注：batch-delete 必须声明在 DELETE /{submission_id} 之前，否则 FastAPI 路由
# 匹配时 "batch-delete" 会被当成 {submission_id} 命中 DELETE 路由。


@router.post("/batch-delete", response_model=BatchDeleteResult)
def batch_delete_submissions(
    body: BatchDeleteIn, db: Session = Depends(get_db)
) -> BatchDeleteResult:
    """批量删除提交。返回实际删除条数与未找到的 id 列表（200，部分失败不抛错）。"""
    deleted, not_found = submission_service.delete_many(db, body.submission_ids)
    return BatchDeleteResult(deleted=deleted, not_found=not_found)


@router.delete(
    "/{submission_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={404: {"model": ErrorResponse}},
)
def delete_submission(submission_id: str, db: Session = Depends(get_db)) -> None:
    """删除单条提交。级联策略见 submission_service.delete_one。"""
    if not submission_service.delete_one(db, submission_id):
        raise _not_found(submission_id)
    return None
