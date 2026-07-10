"""drop problem.reference_solutions_json (remove JavaScript support)

Revision ID: f1a2b3c4d5e6
Revises: 4bf34a7d9c1a
Create Date: 2026-07-04 12:00:00.000000

多语言曾只对少数手工 seed 了 JS 参考解的题开放。JS 始终无本地执行
接地、覆盖率仅 5/160，体验与 Python 割裂，故整体下线 JavaScript。该列唯一用途即装非-Python
参考解，JS 走后即成死列，一并删除。submission.language 保留（仍恒为 "python"）。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, None] = '4bf34a7d9c1a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # DROP COLUMN 在 SQLite 上靠 batch 重建表实现，重建会触发 ON DELETE CASCADE
    # 删掉子表数据。迁移期临时关 FK，跑完再开（与 7dd90 / dd443 同款做法）。
    op.execute("PRAGMA foreign_keys=OFF")
    with op.batch_alter_table("problem", schema=None) as batch_op:
        batch_op.drop_column("reference_solutions_json")
    op.execute("PRAGMA foreign_keys=ON")


def downgrade() -> None:
    op.add_column(
        "problem",
        sa.Column("reference_solutions_json", sa.JSON(), nullable=True),
    )
