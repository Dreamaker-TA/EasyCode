"""submission hint_tier_reached

Revision ID: c245e9913b23
Revises: 838d24d790eb
Create Date: 2026-06-26 17:46:36.279859

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c245e9913b23'
down_revision: Union[str, None] = '838d24d790eb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 提示阶梯持久化。原生 ADD COLUMN：SQLite 直接 ALTER，不重建表，
    # 故无需像 d777 那样担心 submission 的入向/自引用 FK 级联。
    # server_default='0' 让历史行落到 0；NOT NULL 安全。
    op.add_column(
        "submission",
        sa.Column("hint_tier_reached", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    # DROP COLUMN 在 SQLite 上靠 batch 重建表实现，重建会触发 ON DELETE CASCADE
    # 删掉子表数据（snapshot.submission_id → submission.id 等）。迁移期临时关 FK，
    # 跑完再开（与 d777 同款做法，SQLite 文档推荐）。
    op.execute("PRAGMA foreign_keys=OFF")
    with op.batch_alter_table("submission", schema=None) as batch_op:
        batch_op.drop_column("hint_tier_reached")
    op.execute("PRAGMA foreign_keys=ON")
