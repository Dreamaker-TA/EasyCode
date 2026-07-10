"""review_schedule prior_interval_days

Revision ID: 838d24d790eb
Revises: d777fcacd71e
Create Date: 2026-06-26 17:08:19.196183

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '838d24d790eb'
down_revision: Union[str, None] = 'd777fcacd71e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # SRS 复利：复利基数列。nullable，历史行默认 NULL（下次新提交按 interval_days 进位）。
    # review_schedule 无子表指入，batch 重建不触发 cascade，无需 PRAGMA foreign_keys 开关。
    with op.batch_alter_table('review_schedule', schema=None) as batch_op:
        batch_op.add_column(sa.Column('prior_interval_days', sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('review_schedule', schema=None) as batch_op:
        batch_op.drop_column('prior_interval_days')
