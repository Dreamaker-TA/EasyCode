"""problem grading_rubric_md

Revision ID: 08c213afce41
Revises: c245e9913b23
Create Date: 2026-06-26 17:49:05.187374

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '08c213afce41'
down_revision: Union[str, None] = 'c245e9913b23'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 每题评分清单。原生 ADD COLUMN：SQLite 直接 ALTER，不重建 problem 表，
    # 故不触碰其入向 FK（submission/review_schedule/mastery → problem.id）。nullable。
    op.add_column(
        "problem",
        sa.Column("grading_rubric_md", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    # DROP COLUMN 靠 batch 重建表，重建会触发入向 FK 的 CASCADE 删子表数据。
    # 迁移期临时关 FK（同 d777 / c245 做法）。
    op.execute("PRAGMA foreign_keys=OFF")
    with op.batch_alter_table("problem", schema=None) as batch_op:
        batch_op.drop_column("grading_rubric_md")
    op.execute("PRAGMA foreign_keys=ON")
