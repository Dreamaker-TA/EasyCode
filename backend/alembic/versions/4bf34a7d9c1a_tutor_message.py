"""tutor message conversation table

Revision ID: 4bf34a7d9c1a
Revises: 9f7c2b1a5e42
Create Date: 2026-07-03 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "4bf34a7d9c1a"
down_revision: Union[str, None] = "9f7c2b1a5e42"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tutor_message",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("submission_id", sa.String(length=36), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("tier_at", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["submission_id"], ["submission.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("tutor_message", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_tutor_message_submission_id"),
            ["submission_id"],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("tutor_message", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_tutor_message_submission_id"))
    op.drop_table("tutor_message")
