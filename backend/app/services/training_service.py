"""Lightweight training overview aggregation for the home screen."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Mastery, Problem, ReviewSchedule, Submission
from app.services import srs_service, submission_service

POST_REVIEW_WINDOW = timedelta(minutes=30)


def get_overview(db: Session) -> dict:
    now = datetime.now(timezone.utc)
    due_count = _due_count(db, now)
    has_history = _has_history(db)
    recommended = _recommended_problem(db, due_count=due_count)
    recent = _recent_training(db, now)
    problem_count = _problem_count(db)
    has_unpracticed_core = _has_unpracticed_core(db)
    queue = submission_service.review_queue_state(db, now=now)
    review_failed_count = _review_failed_count(db)
    latest_review_failed = _latest_review_failed(db)
    latest_completed = _latest_completed_review(db)
    scheduler = _scheduler_decision(
        due_count=due_count,
        problem_count=problem_count,
        recommended=recommended,
        has_unpracticed_core=has_unpracticed_core,
        has_history=has_history,
        stale_review_count=queue["stale_review_count"],
        review_failed_count=review_failed_count,
        latest_review_failed=latest_review_failed,
        latest_completed=latest_completed,
        now=now,
    )
    audience_state = _audience_state(
        due_count=due_count,
        recommended=recommended,
        has_history=has_history,
    )

    return {
        "today": date.today().isoformat(),
        "due_count": due_count,
        "stale_review_count": queue["stale_review_count"],
        "review_failed_count": review_failed_count,
        "recommended_problem": recommended,
        "recent": recent,
        "has_history": has_history,
        "audience_state": audience_state,
        **scheduler,
    }


def _due_count(db: Session, now: datetime) -> int:
    return int(
        db.execute(
            select(func.count())
            .select_from(ReviewSchedule)
            .where(ReviewSchedule.next_review_at <= now)
        ).scalar_one()
    )


def _has_history(db: Session) -> bool:
    count = db.execute(
        select(func.count())
        .select_from(Submission)
        .where(Submission.status == "submitted")
    ).scalar_one()
    return int(count) > 0


def _problem_count(db: Session) -> int:
    return int(db.execute(select(func.count()).select_from(Problem)).scalar_one())


def _has_unpracticed_core(db: Session) -> bool:
    practiced = select(Submission.problem_id).where(Submission.status == "submitted")
    problem_id = db.execute(
        select(Problem.id)
        .where(Problem.is_core.is_(True), Problem.id.not_in(practiced))
        .limit(1)
    ).scalar_one_or_none()
    return problem_id is not None


def _recommended_problem(
    db: Session,
    *,
    due_count: int,
) -> dict | None:
    if due_count > 0:
        due = db.execute(
            select(Problem)
            .join(ReviewSchedule, ReviewSchedule.problem_id == Problem.id)
            .where(ReviewSchedule.next_review_at <= datetime.now(timezone.utc))
            .order_by(ReviewSchedule.next_review_at.asc())
            .limit(1)
        ).scalar_one_or_none()
        if due is not None:
            return _problem_view(due, "这道题已经到复习时间，先巩固比开新题更有效")

    practiced = select(Submission.problem_id).where(Submission.status == "submitted")
    problem = db.execute(
        select(Problem)
        .where(Problem.is_core.is_(True), Problem.id.not_in(practiced))
        .order_by(Problem.chapter_no.asc(), Problem.problem_no.asc())
        .limit(1)
    ).scalar_one_or_none()
    if problem is not None:
        return _problem_view(problem, "下一道未练过的核心题，适合作为今天的新训练")

    fallback = db.execute(
        select(Problem)
        .order_by(Problem.chapter_no.asc(), Problem.problem_no.asc())
        .limit(1)
    ).scalar_one_or_none()
    if fallback is None:
        return None
    return _problem_view(fallback, "题库已准备好，从第一题开始建立训练记录")


def _recent_training(db: Session, now: datetime) -> dict:
    seven_days_ago = now - timedelta(days=7)
    submissions_7d = int(
        db.execute(
            select(func.count())
            .select_from(Submission)
            .where(
                Submission.status == "submitted",
                Submission.submitted_at >= seven_days_ago,
            )
        ).scalar_one()
    )

    rows = db.execute(
        select(Submission, Problem.category, Mastery)
        .join(Problem, Problem.id == Submission.problem_id)
        .outerjoin(Mastery, Mastery.problem_id == Submission.problem_id)
        .where(Submission.status == "submitted")
        .order_by(
            Submission.submitted_at.desc().nullslast(),
            Submission.created_at.desc(),
            Submission.id.desc(),
        )
    ).all()

    latest_rating = _effective_for_submission(rows[0][0], rows[0][2]) if rows else None
    weak_category = None
    seen_problem_ids: set[int] = set()
    for sub, category, mastery in rows:
        if sub.problem_id in seen_problem_ids:
            continue
        seen_problem_ids.add(sub.problem_id)
        if _effective_for_submission(sub, mastery) in {"C", "D"}:
            weak_category = category
            break

    return {
        "submissions_7d": submissions_7d,
        "latest_rating": latest_rating,
        "weak_category": weak_category,
    }


def _review_failed_count(db: Session) -> int:
    return int(
        db.execute(
            select(func.count())
            .select_from(Submission)
            .where(Submission.status == "review_failed")
        ).scalar_one()
    )


def _latest_review_failed(db: Session) -> dict | None:
    row = db.execute(
        select(
            Submission.id,
            Submission.problem_id,
            Submission.review_last_error_code,
            Problem.title,
        )
        .join(Problem, Problem.id == Submission.problem_id)
        .where(Submission.status == "review_failed")
        .order_by(Submission.reviewed_at.desc().nullslast(), Submission.submitted_at.desc())
        .limit(1)
    ).first()
    if row is None:
        return None
    return {
        "submission_id": row.id,
        "problem_id": row.problem_id,
        "error_code": row.review_last_error_code,
        "title": row.title,
    }


def _latest_completed_review(db: Session) -> dict | None:
    row = db.execute(
        select(
            Submission,
            ReviewSchedule.next_review_at,
            ReviewSchedule.interval_days,
            Problem.title,
            Mastery,
        )
        .join(Problem, Problem.id == Submission.problem_id)
        .outerjoin(ReviewSchedule, ReviewSchedule.from_submission_id == Submission.id)
        .outerjoin(Mastery, Mastery.problem_id == Submission.problem_id)
        .where(
            Submission.status == "submitted",
            Submission.reviewed_at.is_not(None),
        )
        .order_by(Submission.reviewed_at.desc())
        .limit(1)
    ).first()
    if row is None:
        return None
    sub, next_review_at, interval_days, title, mastery = row
    return {
        "submission_id": sub.id,
        "problem_id": sub.problem_id,
        "reviewed_at": _ensure_aware(sub.reviewed_at),
        "rating": _effective_for_submission(sub, mastery),
        "next_review_at": _ensure_aware(next_review_at),
        "interval_days": interval_days,
        "title": title,
    }


def _scheduler_decision(
    *,
    due_count: int,
    problem_count: int,
    recommended: dict | None,
    has_unpracticed_core: bool,
    has_history: bool,
    stale_review_count: int,
    review_failed_count: int,
    latest_review_failed: dict | None,
    latest_completed: dict | None,
    now: datetime,
) -> dict:
    facts = _secondary_facts(
        due_count=due_count,
        stale_review_count=stale_review_count,
        review_failed_count=review_failed_count,
        has_history=has_history,
    )

    if problem_count == 0:
        return _decision(
            state="hard_recovery",
            rank=1,
            reason="数据库里没有可训练题目，不能生成训练推荐。",
            action="settings",
            href="/settings",
            label="打开设置诊断",
            facts=facts,
        )

    if stale_review_count > 0 or review_failed_count > 0:
        if latest_review_failed is not None:
            href = (
                f"/history/{latest_review_failed['problem_id']}"
                f"?submission={latest_review_failed['submission_id']}"
            )
            label = "查看失败评测"
            entity_id = str(latest_review_failed["submission_id"])
            reason = (
                f"{latest_review_failed['title']} 的评测未完成或可重试，"
                "先恢复这条记录再继续训练。"
            )
        else:
            href = "/settings"
            label = "检查评测队列"
            entity_id = None
            reason = "评测队列中有超时任务，先确认服务和 AI 评测设置。"
        return _decision(
            state="review_recovery",
            rank=2,
            reason=reason,
            action="retry_review",
            href=href,
            label=label,
            entity_id=entity_id,
            facts=facts,
        )

    if due_count > 0:
        return _decision(
            state="due_review",
            rank=3,
            reason=f"已有 {due_count} 道题到了计划复习时间，先巩固比开始新题更有效。",
            action="review_due",
            href="/review",
            label=f"先复习 {due_count} 题",
            facts=facts,
        )

    if latest_completed is not None and _is_recent_review(latest_completed, now=now):
        rating = latest_completed["rating"] or "暂无评级"
        next_review = _format_next_review(latest_completed)
        return _decision(
            state="post_review",
            rank=4,
            reason=f"刚完成 {latest_completed['title']} 的评测，评级 {rating}。{next_review}",
            action="review_result",
            href=(
                f"/history/{latest_completed['problem_id']}"
                f"?submission={latest_completed['submission_id']}"
            ),
            label="查看训练处方",
            entity_id=str(latest_completed["submission_id"]),
            facts=facts,
        )

    if recommended is not None and (not has_history or has_unpracticed_core):
        return _decision(
            state="recommended_next",
            rank=5,
            reason=recommended["reason"],
            action="recommended",
            href=f"/problem/{recommended['id']}",
            label="开始推荐题",
            entity_id=str(recommended["id"]),
            facts=facts,
        )

    href = f"/problem/{recommended['id']}" if recommended is not None else "/"
    label = "轻量继续训练" if recommended is not None else "浏览题库"
    entity_id = str(recommended["id"]) if recommended is not None else None
    reason = (
        f"当前没有恢复项或到期复习；可以轻量重做 {recommended['title']}，也可以休息。"
        if recommended is not None
        else "当前没有恢复项、到期复习或可判定推荐题，可以轻量浏览题库或休息。"
    )
    return _decision(
        state="healthy",
        rank=6,
        reason=reason,
        action="browse",
        href=href,
        label=label,
        entity_id=entity_id,
        facts=facts,
    )


def _decision(
    *,
    state: str,
    rank: int,
    reason: str,
    action: str,
    href: str,
    label: str,
    facts: list[dict],
    entity_id: str | None = None,
) -> dict:
    return {
        "scheduler_state": state,
        "state_rank": rank,
        "state_reason": reason,
        "primary_action": action,
        "primary_target": {
            "href": href,
            "label": label,
            "entity_id": entity_id,
        },
        "secondary_facts": facts,
    }


def _secondary_facts(
    *,
    due_count: int,
    stale_review_count: int,
    review_failed_count: int,
    has_history: bool,
) -> list[dict]:
    recovery_count = stale_review_count + review_failed_count
    return [
        {
            "label": "待复习",
            "value": str(due_count),
            "tone": "warn" if due_count else "ok",
        },
        {
            "label": "评测恢复",
            "value": str(recovery_count),
            "tone": "danger" if recovery_count else "ok",
        },
        {
            "label": "训练记录",
            "value": "已建立" if has_history else "未开始",
            "tone": "neutral",
        },
    ]


def _audience_state(
    *,
    due_count: int,
    recommended: dict | None,
    has_history: bool,
) -> str:
    if due_count > 0:
        return "llm_returning_due"
    if recommended is not None:
        return "llm_continue" if has_history else "llm_first_run"
    return "empty_problem_bank"


def _problem_view(problem: Problem, reason: str) -> dict:
    return {
        "id": problem.id,
        "title": problem.title,
        "leetcode_id": problem.leetcode_id,
        "external_id": problem.external_id,
        "category": problem.category,
        "chapter_no": problem.chapter_no,
        "problem_no": problem.problem_no,
        "is_core": problem.is_core,
        "reason": reason,
    }


def _ensure_aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _is_recent_review(review: dict, *, now: datetime) -> bool:
    reviewed_at = review["reviewed_at"]
    return reviewed_at is not None and reviewed_at >= now - POST_REVIEW_WINDOW


def _format_next_review(review: dict) -> str:
    next_review_at = review["next_review_at"]
    if next_review_at is None:
        return "这次没有生成新的复习排程。"
    return f"下次复习已安排到 {next_review_at.date().isoformat()}。"


def _effective_for_submission(sub: Submission, mastery: Mastery | None) -> str | None:
    if mastery is not None and mastery.last_submission_id == sub.id:
        return srs_service.effective_rating(mastery)
    return sub.user_rating_override or sub.review_rating
