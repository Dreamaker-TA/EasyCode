"""每题掌握度（每题唯一一条）。

auto_rating = LLM 最新一次评级；user_rating = 用户覆盖。
effective_rating 在 API 层计算（user_rating ?? auto_rating）。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, utcnow


class Mastery(Base):
    __tablename__ = "mastery"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    problem_id: Mapped[int] = mapped_column(
        ForeignKey("problem.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    auto_rating: Mapped[str | None] = mapped_column(String(2), nullable=True)
    user_rating: Mapped[str | None] = mapped_column(String(2), nullable=True)
    last_submission_id: Mapped[str | None] = mapped_column(
        ForeignKey("submission.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )
