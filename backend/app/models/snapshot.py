"""30s 代码快照。

去重：(submission_id, t_offset_sec) 联合唯一。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, utcnow


class Snapshot(Base):
    __tablename__ = "snapshot"
    __table_args__ = (
        UniqueConstraint(
            "submission_id", "t_offset_sec", name="uq_snapshot_sub_offset"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    submission_id: Mapped[str] = mapped_column(
        ForeignKey("submission.id", ondelete="CASCADE"), nullable=False, index=True
    )
    t_offset_sec: Mapped[int] = mapped_column(Integer, nullable=False)
    code: Mapped[str] = mapped_column(Text, nullable=False)
    code_hash: Mapped[str] = mapped_column(String(12), nullable=False)
    # "code" = 正常代码快照 | "submit_marker" = 上一次提交瞬间的标注帧(续编流注入)
    kind: Mapped[str] = mapped_column(
        String(16), nullable=False, default="code", server_default="code"
    )
    client_ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
