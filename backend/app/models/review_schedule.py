"""每题最新一条复习计划（next_review_at）。

upsert by problem_id：新提交时覆盖。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, utcnow


class ReviewSchedule(Base):
    __tablename__ = "review_schedule"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    problem_id: Mapped[int] = mapped_column(
        ForeignKey("problem.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    from_submission_id: Mapped[str] = mapped_column(
        ForeignKey("submission.id", ondelete="CASCADE"), nullable=False
    )
    generated_from_rating: Mapped[str] = mapped_column(String(2), nullable=False)
    interval_days: Mapped[int] = mapped_column(Integer, nullable=False)
    # 复利基数：算出本行 interval_days 时用作乘数的"上次间隔"。
    # NULL = 该次用基础映射（首复习 / C·D 重置 / 历史行）。同一评测事件重算时冻结不变，
    # 故重复 PATCH 覆盖、retry 重评不会二次进位。见 srs_service._refresh_schedule。
    prior_interval_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    next_review_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
