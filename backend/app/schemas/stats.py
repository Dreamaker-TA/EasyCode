"""Growth stats schema for the history dashboard."""

from __future__ import annotations

from pydantic import BaseModel


class DailySubmissionCount(BaseModel):
    date: str
    submissions: int


class WeakCategory(BaseModel):
    category: str
    low_rating_count: int
    submissions: int


class RetriedProblem(BaseModel):
    problem_id: int
    title: str
    submissions_count: int


class GrowthStats(BaseModel):
    window_days: int
    submissions: int
    rating_counts: dict[str, int]
    review_due_count: int
    daily_submissions: list[DailySubmissionCount]
    weak_categories: list[WeakCategory]
    most_retried_problems: list[RetriedProblem]
