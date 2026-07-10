"""题目只读 API。

路径前缀 /api 由 main.py include_router 时统一加。
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.settings import settings
from app.schemas.problem import (
    ErrorDetail,
    ErrorResponse,
    ProblemDetail,
    ProblemListResponse,
)
from app.schemas.submission import SubmissionListResponse
from app.schemas.testcase import ProblemTestsResponse
from app.services import problem_service, submission_service

router = APIRouter(prefix="/problems", tags=["problems"])


@router.get("", response_model=ProblemListResponse)
def list_problems(
    category: str | None = None,
    core_only: bool = False,
    q: str | None = None,
    limit: int = Query(default=500, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> ProblemListResponse:
    items, total = problem_service.list_problems(
        db,
        category=category,
        core_only=core_only,
        q=q,
        limit=limit,
        offset=offset,
    )
    return ProblemListResponse(items=items, total=total)


@router.get(
    "/{problem_id}",
    response_model=ProblemDetail,
    responses={404: {"model": ErrorResponse}},
)
def get_problem(problem_id: int, db: Session = Depends(get_db)) -> ProblemDetail:
    detail = problem_service.get_problem(db, problem_id)
    if detail is None:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(
                error=ErrorDetail(
                    code="PROBLEM_NOT_FOUND",
                    message=f"problem id {problem_id} not found",
                )
            ).model_dump(),
        )
    return ProblemDetail(**detail)


@router.get(
    "/{problem_id}/tests",
    response_model=ProblemTestsResponse,
    responses={404: {"model": ErrorResponse}},
)
def get_problem_tests(
    problem_id: int,
    include_hidden: bool = Query(
        default=False,
        description="全量通道：下发非样例 stdin/expected 供前端跑全量。仅 EXECUTOR!=none 时生效。",
    ),
    db: Session = Depends(get_db),
) -> ProblemTestsResponse:
    """执行接地测试用例。无边车 → has_tests=false；默认只暴露样例的 stdin/expected。

    ``include_hidden=1`` + ``EXECUTOR != none`` → 全量通道：非样例 I/O
    一并下发，让前端 submit 时跑全量用例坐实 grounding。**破 18 防泄边界，仅本地单用户可接受**；
    EXECUTOR=none 时强制屏蔽（忽略该参数）。
    """
    reveal_hidden = include_hidden and settings.EXECUTOR != "none"
    view = problem_service.get_tests_view(db, problem_id, reveal_hidden=reveal_hidden)
    if view is None:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(
                error=ErrorDetail(
                    code="PROBLEM_NOT_FOUND",
                    message=f"problem id {problem_id} not found",
                )
            ).model_dump(),
        )
    return ProblemTestsResponse(**view)


@router.get(
    "/{problem_id}/submissions",
    response_model=SubmissionListResponse,
    responses={404: {"model": ErrorResponse}},
)
def list_problem_submissions(
    problem_id: int,
    status: Literal["submitted", "all"] = Query(
        default="submitted",
        description="submitted | all",
    ),
    limit: int = Query(default=20, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> SubmissionListResponse:
    """题目历次提交概览。。"""
    if problem_service.get_problem(db, problem_id) is None:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(
                error=ErrorDetail(
                    code="PROBLEM_NOT_FOUND",
                    message=f"problem id {problem_id} not found",
                )
            ).model_dump(),
        )
    items, total = submission_service.list_for_problem(
        db, problem_id, status=status, limit=limit, offset=offset
    )
    return SubmissionListResponse(items=items, total=total)
