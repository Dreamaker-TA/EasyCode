"""题目模型。

字段规范以数据库迁移、OpenAPI schema 与种子脚本为准。
"""

from __future__ import annotations

from sqlalchemy import Boolean, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Problem(Base, TimestampMixin):
    __tablename__ = "problem"
    __table_args__ = (
        UniqueConstraint("category", "problem_no", name="uq_problem_cat_no"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    leetcode_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    external_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    chapter_no: Mapped[int] = mapped_column(Integer, nullable=False)
    problem_no: Mapped[int] = mapped_column(Integer, nullable=False)
    is_core: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    statement_md: Mapped[str] = mapped_column(Text, nullable=False)
    reference_solution_md: Mapped[str] = mapped_column(Text, nullable=False)
    # 每题评分检查清单：非空时注入 review_user.j2 作该题正确性清单。
    # 与 reference_solution_md 一样属"判分用、不外泄"，故不进 ProblemDetail。
    grading_rubric_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_path: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
