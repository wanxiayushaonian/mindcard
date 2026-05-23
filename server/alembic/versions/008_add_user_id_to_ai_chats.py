"""Add user_id to ai_chats for chat ownership

Revision ID: 008
Revises: 007
Create Date: 2026-05-23
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "008"
down_revision: Union[str, None] = "007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "ai_chats",
        sa.Column(
            "user_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.create_index("ix_ai_chats_user_id", "ai_chats", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_ai_chats_user_id", table_name="ai_chats")
    op.drop_column("ai_chats", "user_id")
