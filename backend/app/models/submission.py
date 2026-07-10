"""提交模型。

生命周期：draft → submitted（finalize 时翻转）。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Submission(Base):
    __tablename__ = "submission"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    problem_id: Mapped[int] = mapped_column(
        ForeignKey("problem.id", ondelete="CASCADE"), nullable=False, index=True
    )

    code: Mapped[str] = mapped_column(Text, nullable=False, default="")
    elapsed_sec: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # mode: untimed | timed
    mode: Mapped[str] = mapped_column(String(16), nullable=False, default="untimed")
    mode_limit_sec: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # 本次提交所用语言：默认 "python"。
    # 在 create_draft 时定（整局固定）——求助(ask_for_help)在草稿期就要据它选代码栅栏 /
    # 参考解，故 help 与 review 同读这一个源。NOT NULL + server_default 让旧行回填 "python"。
    language: Mapped[str] = mapped_column(
        String(16), nullable=False, default="python", server_default="python"
    )

    # status: draft | reviewing | submitted | review_failed
    # （异步评测：finalize→reviewing，后台评测完成→submitted / 降级→review_failed。
    #  String(16) 已够装最长 "review_failed"(13)，无需迁移。）
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft", index=True)

    # C/D 评级后允许"续编"——新 submission 通过此字段指向上一次,LLM 评测时能拼出完整链。
    parent_submission_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("submission.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # 评测结果（finalize 后写）
    review_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    review_rating: Mapped[str | None] = mapped_column(String(2), nullable=True, index=True)
    review_can_compile: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # 执行结果：finalize 时由后端按题目测试套件复跑产出的
    # RunResult（{verdict, passed, total, failures, error?}）。必须落库——的后台
    # 评测在独立 session 里读它，retry 重评也据此重读保 grounding。
    # 无测试套件 / EXECUTOR=none → None（纯 LLM 降级）。
    test_results_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # 用户覆盖评级（来自PATCH）
    user_rating_override: Mapped[str | None] = mapped_column(String(2), nullable=True)

    # 苏格拉底提示阶梯已达层级：ask_for_help 每成功一次单调 +1，封顶 4。
    # 让分级提示跨多次求助持久递进，而非每次从第 1 层重来。
    hint_tier_reached: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    review_last_error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
