"""跨题目历史聚合接口的 Pydantic schema。"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class HistoryListItem(BaseModel):
    """每题 1 行的历史概览(只列「至少有一次 submitted」的题)。"""

    problem_id: int
    title: str
    category: str
    chapter_no: int
    problem_no: int
    is_core: bool

    submissions_count: int
    latest_submitted_at: datetime
    # 最新一次的当前生效评级；若当前题有用户覆盖，后端用 mastery effective 覆盖展示。
    latest_rating: Literal["A", "B", "C", "D"] | None
    latest_summary: str | None = None


class HistoryListResponse(BaseModel):
    items: list[HistoryListItem]
    total: int
