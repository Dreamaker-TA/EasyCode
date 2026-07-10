"""submission review recovery fields

Revision ID: 9f7c2b1a5e42
Revises: 7dd90ed97fb6
Create Date: 2026-07-02 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "9f7c2b1a5e42"
down_revision: Union[str, None] = "7dd90ed97fb6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 异步评测恢复状态机：记录当前/最近一次评测尝试的开始时间、
    # 尝试次数和最后错误码。nullable 字段保留已有行；attempts 以 0 回填。
    op.add_column(
        "submission",
        sa.Column("review_started_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "submission",
        sa.Column(
            "review_attempts",
            sa.Integer(),
            server_default="0",
            nullable=False,
        ),
    )
    op.add_column(
        "submission",
        sa.Column("review_last_error_code", sa.String(length=64), nullable=True),
    )


def downgrade() -> None:
    # SQLite DROP COLUMN 走 batch 重建表；临时关 FK，避免重建 submission 时级联误删子表。
    op.execute("PRAGMA foreign_keys=OFF")
    with op.batch_alter_table("submission", schema=None) as batch_op:
        batch_op.drop_column("review_last_error_code")
        batch_op.drop_column("review_attempts")
        batch_op.drop_column("review_started_at")
    op.execute("PRAGMA foreign_keys=ON")
