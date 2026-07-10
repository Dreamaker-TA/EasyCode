"""Growth dashboard aggregation."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Mastery, Problem, ReviewSchedule, Submission
from app.services import srs_service

RATINGS = ("A", "B", "C", "D")


def get_growth_stats(db: Session, *, window_days: int = 7) -> dict:
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=window_days)
    rating_counts = _rating_counts(db, start)
    daily_submissions = _daily_submissions(db, start=start, window_days=window_days)

    return {
        "window_days": window_days,
        "submissions": _submission_count(db, start),
        "rating_counts": rating_counts,
        "review_due_count": _review_due_count(db, now),
        "daily_submissions": daily_submissions,
        "weak_categories": _weak_categories(db),
        "most_retried_problems": _most_retried_problems(db),
    }


def _rating_counts(db: Session, start: datetime) -> dict[str, int]:
    rows = db.execute(
        select(Submission, Mastery)
        .outerjoin(Mastery, Mastery.problem_id == Submission.problem_id)
        .where(
            Submission.status == "submitted",
            Submission.submitted_at >= start,
            Submission.review_rating.in_(RATINGS),
        )
    ).all()
    counts = {rating: 0 for rating in RATINGS}
    for sub, mastery in rows:
        rating = _effective_for_submission(sub, mastery)
        if rating in counts:
            counts[rating] += 1
    return counts


def _submission_count(db: Session, start: datetime) -> int:
    return int(
        db.execute(
            select(func.count())
            .select_from(Submission)
            .where(
                Submission.status == "submitted",
                Submission.submitted_at >= start,
            )
        ).scalar_one()
    )


def _review_due_count(db: Session, now: datetime) -> int:
    return int(
        db.execute(
            select(func.count())
            .select_from(ReviewSchedule)
            .where(ReviewSchedule.next_review_at <= now)
        ).scalar_one()
    )


def _daily_submissions(
    db: Session,
    *,
    start: datetime,
    window_days: int,
) -> list[dict]:
    today = date.today()
    buckets = {
        (today - timedelta(days=offset)).isoformat(): 0
        for offset in range(window_days - 1, -1, -1)
    }
    rows = db.execute(
        select(func.date(Submission.submitted_at), func.count())
        .where(
            Submission.status == "submitted",
            Submission.submitted_at >= start,
        )
        .group_by(func.date(Submission.submitted_at))
    ).all()
    for day, count in rows:
        if day in buckets:
            buckets[str(day)] = int(count)
    return [{"date": day, "submissions": count} for day, count in buckets.items()]


def _weak_categories(db: Session) -> list[dict]:
    rows = db.execute(
        select(
            Problem.category,
            Submission,
            Mastery,
        )
        .join(Submission, Submission.problem_id == Problem.id)
        .outerjoin(Mastery, Mastery.problem_id == Problem.id)
        .where(Submission.status == "submitted")
        .order_by(
            Submission.submitted_at.desc().nullslast(),
            Submission.created_at.desc(),
            Submission.id.desc(),
        )
    ).all()
    grouped: dict[str, dict[str, int]] = {}
    seen_problem_ids: set[int] = set()
    for category, sub, mastery in rows:
        if sub.problem_id in seen_problem_ids:
            continue
        seen_problem_ids.add(sub.problem_id)
        bucket = grouped.setdefault(category, {"low": 0, "total": 0})
        bucket["total"] += 1
        if _effective_for_submission(sub, mastery) in {"C", "D"}:
            bucket["low"] += 1
    return [
        {
            "category": category,
            "low_rating_count": counts["low"],
            "submissions": counts["total"],
        }
        for category, counts in sorted(
            grouped.items(),
            key=lambda item: (-item[1]["low"], -item[1]["total"], item[0]),
        )[:4]
        if counts["low"] > 0
    ]


def _most_retried_problems(db: Session) -> list[dict]:
    rows = db.execute(
        select(
            Problem.id,
            Problem.title,
            func.count(Submission.id).label("submission_count"),
            func.max(Submission.submitted_at).label("latest_submitted_at"),
        )
        .join(Submission, Submission.problem_id == Problem.id)
        .where(Submission.status == "submitted")
        .group_by(Problem.id)
        .having(func.count(Submission.id) > 1)
        .order_by(func.count(Submission.id).desc(), func.max(Submission.submitted_at).desc())
        .limit(4)
    ).all()
    return [
        {
            "problem_id": problem_id,
            "title": title,
            "submissions_count": int(count),
        }
        for problem_id, title, count, _latest in rows
    ]


def _effective_for_submission(sub: Submission, mastery: Mastery | None) -> str | None:
    if mastery is not None and mastery.last_submission_id == sub.id:
        return srs_service.effective_rating(mastery)
    return sub.user_rating_override or sub.review_rating
