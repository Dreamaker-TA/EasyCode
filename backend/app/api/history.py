"""跨题目历史聚合 API:供前端「历史」tab 用。

每题只出 1 行,按"最近一次 submitted 提交时间"倒序。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import Mastery, Problem, Submission
from app.schemas.history import HistoryListItem, HistoryListResponse
from app.services import srs_service

router = APIRouter(prefix="/history", tags=["history"])


@router.get("/problems", response_model=HistoryListResponse)
def list_problem_history(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> HistoryListResponse:
    """返回所有「至少一次 submitted」的题,每题 1 行,最新提交时间倒序。"""

    # 子查询:每题 latest submission + ROW_NUMBER 过滤
    ranked = (
        select(
            Submission.problem_id,
            Submission.id.label("submission_id"),
            Submission.review_rating,
            Submission.user_rating_override,
            Submission.review_json,
            Submission.submitted_at,
            func.row_number()
            .over(
                partition_by=Submission.problem_id,
                order_by=(
                    Submission.submitted_at.desc(),
                    Submission.created_at.desc(),
                    Submission.id.desc(),
                ),
            )
            .label("rn"),
        )
        .where(Submission.status == "submitted")
        .subquery()
    )

    counts = (
        select(
            Submission.problem_id.label("pid"),
            func.count().label("cnt"),
        )
        .where(Submission.status == "submitted")
        .group_by(Submission.problem_id)
        .subquery()
    )

    base = (
        select(
            Problem,
            ranked.c.review_rating,
            ranked.c.user_rating_override,
            ranked.c.submission_id,
            ranked.c.review_json,
            ranked.c.submitted_at,
            counts.c.cnt,
            Mastery,
        )
        .join(ranked, (ranked.c.problem_id == Problem.id) & (ranked.c.rn == 1))
        .join(counts, counts.c.pid == Problem.id)
        .outerjoin(Mastery, Mastery.problem_id == Problem.id)
    )

    total = db.execute(
        select(func.count()).select_from(base.subquery())
    ).scalar_one()

    stmt = (
        base.order_by(ranked.c.submitted_at.desc())
        .limit(limit)
        .offset(offset)
    )

    rows = db.execute(stmt).all()
    items = [
        HistoryListItem(
            problem_id=problem.id,
            title=problem.title,
            category=problem.category,
            chapter_no=problem.chapter_no,
            problem_no=problem.problem_no,
            is_core=problem.is_core,
            submissions_count=int(cnt),
            latest_submitted_at=submitted_at,
            latest_rating=(
                srs_service.effective_rating(mastery)
                if mastery is not None and mastery.last_submission_id == submission_id
                else (user_rating_override or rating)
            ),
            latest_summary=_review_summary(review_json),
        )
        for (
            problem,
            rating,
            user_rating_override,
            submission_id,
            review_json,
            submitted_at,
            cnt,
            mastery,
        ) in rows
    ]
    return HistoryListResponse(items=items, total=int(total))


def _review_summary(review_json: dict | None) -> str | None:
    if not review_json:
        return None
    for value in (
        review_json.get("rating_rationale"),
        _first_optimization(review_json),
        review_json.get("process_review"),
    ):
        if isinstance(value, str) and value.strip():
            text = " ".join(value.strip().split())
            return text[:96] + ("…" if len(text) > 96 else "")
    return None


def _first_optimization(review_json: dict) -> str | None:
    optimization = review_json.get("optimization")
    if isinstance(optimization, list) and optimization:
        first = optimization[0]
        if isinstance(first, str):
            return first
    return None
