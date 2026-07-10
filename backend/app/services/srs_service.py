"""SRS（Spaced Repetition Schedule）+ Mastery 服务。

评级 → 间隔常量 **唯一规范源**：见下方 RATING_INTERVAL_DAYS。
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Mastery, Problem, ReviewSchedule, Submission

# === 规范源：评级 → 间隔（天）。修改时同步 SRS 与训练概览相关测试。 ===
RATING_INTERVAL_DAYS: dict[str, int] = {
    "A": 14,
    "B": 7,
    "C": 3,
    "D": 1,
}


def effective_rating(m: Mastery) -> str | None:
    return m.user_rating or m.auto_rating


def _effective_rating(m: Mastery) -> str | None:
    return effective_rating(m)


def _interval_for(rating: str | None) -> int:
    """未知评级默认 7 天（与 B 同档）。"""
    return RATING_INTERVAL_DAYS.get(rating or "", 7)


# === SRS 复利。 ===
# 成功评级在"上次间隔"上乘系数增长；C/D/未知/首复习重置回基础映射；封顶 180 天。
EASE_FACTORS: dict[str, float] = {"A": 2.0, "B": 1.3}
INTERVAL_CAP_DAYS = 180


def _compound_interval(rating: str | None, prior: int | None) -> int:
    """根据评级与上次间隔算下次间隔。

    - prior is None（首复习）或 rating 不在 EASE_FACTORS（C/D/未知）→ 重置基础映射；
    - A/B 且有 prior → min(round(prior × ease), 180)。
    RATING_INTERVAL_DAYS 仍是基础映射的唯一规范源。
    """
    if prior is None or rating not in EASE_FACTORS:
        return _interval_for(rating)
    return min(round(prior * EASE_FACTORS[rating]), INTERVAL_CAP_DAYS)


def upsert_mastery_and_schedule(db: Session, sub: Submission) -> None:
    """提交 finalize 完成后调，把评级落进 Mastery，并刷新 ReviewSchedule。

    不覆盖 user_rating；仅写 auto_rating + last_submission_id。
    新提交代表新的作答证据，若题目变化则清空用户覆盖。
    """
    rating = sub.review_rating
    if rating is None:
        # 评测失败也可发生（降级返回 rating="C"），但若为 None 则不入 SRS
        return
    db.flush()
    if not _is_latest_rated_submission(db, sub):
        db.commit()
        return

    m = db.scalar(select(Mastery).where(Mastery.problem_id == sub.problem_id))
    previous_latest_id = m.last_submission_id if m is not None else None
    if m is None:
        m = Mastery(problem_id=sub.problem_id, auto_rating=rating)
        db.add(m)
    else:
        m.auto_rating = rating
    if previous_latest_id != sub.id:
        m.user_rating = None
        sub.user_rating_override = None
    else:
        sub.user_rating_override = m.user_rating
    m.last_submission_id = sub.id

    db.flush()  # 让 m 在同一事务内可见

    _refresh_schedule(db, sub.problem_id, sub.id, sub.submitted_at)
    db.commit()


def _is_latest_rated_submission(db: Session, sub: Submission) -> bool:
    latest_id = db.scalar(
        select(Submission.id)
        .where(
            Submission.problem_id == sub.problem_id,
            Submission.status == "submitted",
            Submission.review_rating.is_not(None),
        )
        .order_by(
            Submission.submitted_at.desc().nulls_last(),
            Submission.created_at.desc(),
            Submission.id.desc(),
        )
        .limit(1)
    )
    return latest_id == sub.id


def _refresh_schedule(
    db: Session,
    problem_id: int,
    from_submission_id: str,
    anchor_ts: datetime | None,
) -> ReviewSchedule:
    """根据当前 Mastery 的 effective_rating 重算 ReviewSchedule（每题一条 upsert）。

    复利：先取既有 schedule，按 from_submission_id 判定本次属于"新提交事件"
    （进位：用上次 interval_days 作基数）还是"同一评测的重算"（手动覆盖 / retry 重评，
    冻结 prior 幂等重算，不二次进位）。
    """
    m = db.scalar(select(Mastery).where(Mastery.problem_id == problem_id))
    effective = _effective_rating(m) if m else None

    sch = db.scalar(select(ReviewSchedule).where(ReviewSchedule.problem_id == problem_id))
    if sch is None:
        prior = None  # 首复习
    elif sch.from_submission_id == from_submission_id:
        prior = sch.prior_interval_days  # 同一评测事件 → 冻结 prior，幂等重算
    else:
        prior = sch.interval_days  # 新提交事件 → 上次间隔作复利基数（进位）
    days = _compound_interval(effective, prior)

    now = datetime.now(timezone.utc)
    base = anchor_ts or now
    # SQLite 经常以 naive datetime 取回（即使存的是 tz-aware），统一加 UTC
    if base.tzinfo is None:
        base = base.replace(tzinfo=timezone.utc)
    if base < now:
        base = now
    next_at = base + timedelta(days=days)

    if sch is None:
        sch = ReviewSchedule(
            problem_id=problem_id,
            from_submission_id=from_submission_id,
            generated_from_rating=effective or "B",
            prior_interval_days=prior,
            interval_days=days,
            next_review_at=next_at,
        )
        db.add(sch)
    else:
        sch.from_submission_id = from_submission_id
        sch.generated_from_rating = effective or "B"
        sch.prior_interval_days = prior
        sch.interval_days = days
        sch.next_review_at = next_at
    db.flush()
    return sch


def update_user_rating(
    db: Session, problem_id: int, user_rating: str | None
) -> dict | None:
    """PATCH /problems/{id}/mastery 的 service。

    返回当前掌握度 + SRS 概览的 dict；若题目不存在返回 None。
    """
    if db.get(Problem, problem_id) is None:
        return None

    m = db.scalar(select(Mastery).where(Mastery.problem_id == problem_id))
    if m is None:
        m = Mastery(problem_id=problem_id, user_rating=user_rating)
        db.add(m)
    else:
        m.user_rating = user_rating
    db.flush()

    sch = None
    if m.last_submission_id:
        sub = db.get(Submission, m.last_submission_id)
        if sub is not None and sub.status == "submitted":
            sub.user_rating_override = user_rating
        sch = _refresh_schedule(
            db,
            problem_id,
            from_submission_id=m.last_submission_id,
            anchor_ts=datetime.now(timezone.utc),
        )
    db.commit()

    return {
        "problem_id": problem_id,
        "auto_rating": m.auto_rating,
        "user_rating": m.user_rating,
        "effective_rating": _effective_rating(m),
        "next_review_at": sch.next_review_at if sch else None,
        "interval_days": sch.interval_days if sch else None,
    }


def query_due(db: Session, *, now: datetime | None = None, limit: int = 100) -> list[dict]:
    now = now or datetime.now(timezone.utc)
    rows = (
        db.execute(
            select(ReviewSchedule, Problem, Mastery, Submission.submitted_at)
            .join(Problem, Problem.id == ReviewSchedule.problem_id)
            .outerjoin(Mastery, Mastery.problem_id == ReviewSchedule.problem_id)
            .outerjoin(Submission, Submission.id == ReviewSchedule.from_submission_id)
            .where(ReviewSchedule.next_review_at <= now)
            .order_by(ReviewSchedule.next_review_at.asc())
            .limit(limit)
        )
        .all()
    )
    items: list[dict] = []
    for sch, p, m, last_reviewed_at in rows:
        due_at = sch.next_review_at
        if due_at.tzinfo is None:
            due_at = due_at.replace(tzinfo=timezone.utc)
        days_overdue = max(0, (now - due_at).days)
        effective_rating = _effective_rating(m) if m else None
        items.append(
            {
                "problem_id": p.id,
                "leetcode_id": p.leetcode_id,
                "external_id": p.external_id,
                "title": p.title,
                "category": p.category,
                "effective_rating": effective_rating,
                "due_at": due_at,
                "days_overdue": days_overdue,
                "priority": _due_priority(effective_rating, days_overdue),
                "reason_codes": _due_reason_codes(
                    effective_rating,
                    days_overdue,
                    sch.interval_days,
                ),
                "interval_days": sch.interval_days,
                "last_reviewed_at": last_reviewed_at,
            }
        )
    return items


def _due_priority(rating: str | None, days_overdue: int) -> str:
    if (rating in {"C", "D"} and days_overdue > 0) or days_overdue >= 7:
        return "must"
    if days_overdue == 0 or rating == "B":
        return "recommended"
    return "optional"


def _due_reason_codes(
    rating: str | None,
    days_overdue: int,
    interval_days: int | None,
) -> list[str]:
    codes: list[str] = ["due_today" if days_overdue == 0 else "overdue"]
    if days_overdue >= 7:
        codes.append("long_overdue")
    if rating in {"C", "D"}:
        codes.append("low_rating")
    elif rating == "B":
        codes.append("medium_rating")
    elif rating == "A":
        codes.append("strong_rating")
    if interval_days is not None:
        codes.append("short_interval" if interval_days <= 3 else "interval")
    return codes
