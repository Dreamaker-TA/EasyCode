"""submission language + problem reference_solutions_json

Revision ID: 7dd90ed97fb6
Revises: dd443a00c121
Create Date: 2026-06-27 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '7dd90ed97fb6'
down_revision: Union[str, None] = 'dd443a00c121'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 多语言：
    # - submission.language：本次提交用的语言，默认 "python"。NOT NULL + server_default
    #   让旧行回填 "python"（同 hint_tier_reached 双默认做法）。原生 ADD COLUMN。
    # - problem.reference_solutions_json：非-Python 的参考解 {lang: md}（Python 仍用
    #   reference_solution_md）。nullable —— 无非-Python 参考解 → NULL，该题仅开放 Python。
    op.add_column(
        "submission",
        sa.Column("language", sa.String(length=16), nullable=False, server_default="python"),
    )
    op.add_column(
        "problem",
        sa.Column("reference_solutions_json", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    # DROP COLUMN 在 SQLite 上靠 batch 重建表实现，重建会触发 ON DELETE CASCADE
    # 删掉子表数据。迁移期临时关 FK，跑完再开（与 dd443 / c245 同款做法）。
    op.execute("PRAGMA foreign_keys=OFF")
    with op.batch_alter_table("problem", schema=None) as batch_op:
        batch_op.drop_column("reference_solutions_json")
    with op.batch_alter_table("submission", schema=None) as batch_op:
        batch_op.drop_column("language")
    op.execute("PRAGMA foreign_keys=ON")
