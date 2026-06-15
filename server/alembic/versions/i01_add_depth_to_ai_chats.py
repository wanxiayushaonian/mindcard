"""add depth column to ai_chats

Revision ID: i01_add_depth_to_ai_chats
Revises: h01_topic_card_unique
Create Date: 2026-06-14 21:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "i01_add_depth_to_ai_chats"
down_revision: Union[str, None] = "h01_topic_card_unique"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("ai_chats", sa.Column("depth", sa.Integer(), nullable=False, server_default="0"))

    # Backfill existing rows using a recursive CTE that walks parent_id chain
    op.execute("""
        WITH RECURSIVE depth_calc AS (
            SELECT id, 0 AS d
            FROM ai_chats
            WHERE parent_id IS NULL
            UNION ALL
            SELECT c.id, p.d + 1
            FROM ai_chats c
            JOIN depth_calc p ON c.parent_id = p.id
        )
        UPDATE ai_chats
        SET depth = depth_calc.d
        FROM depth_calc
        WHERE ai_chats.id = depth_calc.id
    """)


def downgrade() -> None:
    op.drop_column("ai_chats", "depth")
