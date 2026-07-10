"""Training overview schema for the productized home screen."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class RecommendedProblem(BaseModel):
    id: int
    title: str
    leetcode_id: int | None
    external_id: str | None
    category: str
    chapter_no: int
    problem_no: int
    is_core: bool
    reason: str


class RecentTraining(BaseModel):
    submissions_7d: int
    latest_rating: Literal["A", "B", "C", "D"] | None
    weak_category: str | None


class PrimaryTarget(BaseModel):
    href: str
    label: str
    entity_id: str | None = None


class SecondaryFact(BaseModel):
    label: str
    value: str
    tone: Literal["neutral", "ok", "warn", "danger"] = "neutral"


class TrainingOverview(BaseModel):
    today: str
    due_count: int
    stale_review_count: int
    review_failed_count: int
    recommended_problem: RecommendedProblem | None
    recent: RecentTraining
    has_history: bool
    audience_state: Literal[
        "llm_first_run",
        "llm_continue",
        "llm_returning_due",
        "empty_problem_bank",
    ]
    scheduler_state: Literal[
        "hard_recovery",
        "review_recovery",
        "due_review",
        "post_review",
        "recommended_next",
        "healthy",
    ]
    state_rank: int
    state_reason: str
    primary_action: Literal[
        "settings",
        "retry_review",
        "review_due",
        "review_result",
        "recommended",
        "browse",
    ]
    primary_target: PrimaryTarget
    secondary_facts: list[SecondaryFact]
