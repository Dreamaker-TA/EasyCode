"""对话式助教 API schema。"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

CODE_MAX_CHARS = 200_000


class TutorMessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    current_code: str | None = Field(default=None, max_length=CODE_MAX_CHARS)


class TutorMessagePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    submission_id: str
    role: Literal["student", "tutor"]
    content: str
    tier_at: int = Field(ge=0, le=4)
    created_at: datetime


class TutorMessageListResponse(BaseModel):
    messages: list[TutorMessagePublic]


class TutorMessagePostResponse(BaseModel):
    message: TutorMessagePublic
    tier_before: int = Field(ge=0, le=4)
    tier_after: int = Field(ge=0, le=4)
