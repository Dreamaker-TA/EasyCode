"""submission test_results_json

Revision ID: dd443a00c121
Revises: 08c213afce41
Create Date: 2026-06-27 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'dd443a00c121'
down_revision: Union[str, None] = '08c213afce41'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # run-then-review：finalize 时前端 Pyodide 执行结果（RunResult）
    # 落库，后台异步评测据它短路 / 喂 LLM，retry 重评也重读它。nullable —— 无执行
    # （EXECUTOR=none / 无边车）→ NULL，纯 LLM 降级。原生 ADD COLUMN，SQLite 直接 ALTER。
    op.add_column(
        "submission",
        sa.Column("test_results_json", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    # DROP COLUMN 在 SQLite 上靠 batch 重建表实现，重建会触发 ON DELETE CASCADE
    # 删掉子表数据。迁移期临时关 FK，跑完再开（与 c245 / d777 同款做法）。
    op.execute("PRAGMA foreign_keys=OFF")
    with op.batch_alter_table("submission", schema=None) as batch_op:
        batch_op.drop_column("test_results_json")
    op.execute("PRAGMA foreign_keys=ON")
