"""题目接口的 Pydantic schema。

关键不变量：任何对外 schema 都**不能**含 reference_solution_md。
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class MasteryView(BaseModel):
    """API 视图：effective_rating 由后端在 service 层算出。"""

    effective_rating: str | None = None
    user_rating: str | None = None
    auto_rating: str | None = None


class ProblemListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    leetcode_id: int | None
    external_id: str | None
    title: str
    category: str
    chapter_no: int
    problem_no: int
    is_core: bool
    mastery: MasteryView | None = None


class ProblemDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    leetcode_id: int | None
    external_id: str | None
    title: str
    category: str
    chapter_no: int
    problem_no: int
    is_core: bool
    statement_md: str
    # 该题可写/可评的语言集。JavaScript 已整体下线，现恒为 ["python"]（见
    # problem_service.supported_languages）。
    supported_languages: list[str] = ["python"]
    mastery: MasteryView | None = None
    last_submission_id: str | None = None


class ProblemListResponse(BaseModel):
    items: list[ProblemListItem]
    total: int = Field(description="过滤后的总数（不受 limit/offset 影响）")


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: dict = Field(default_factory=dict)


class ErrorResponse(BaseModel):
    error: ErrorDetail
