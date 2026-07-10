"""Mastery / SRS 接口的 Pydantic schema。"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


RatingLetter = Literal["A", "B", "C", "D"]


class MasteryUpdate(BaseModel):
    user_rating: RatingLetter | None = None


class MasteryAfterUpdate(BaseModel):
    problem_id: int
    auto_rating: str | None
    user_rating: str | None
    effective_rating: str | None
    next_review_at: datetime | None
    interval_days: int | None


class DueItem(BaseModel):
    problem_id: int
    leetcode_id: int | None
    external_id: str | None
    title: str
    category: str
    effective_rating: str | None
    due_at: datetime
    days_overdue: int
    priority: Literal["must", "recommended", "optional"]
    reason_codes: list[str]
    interval_days: int | None
    last_reviewed_at: datetime | None


class DueResponse(BaseModel):
    today: str
    items: list[DueItem]
