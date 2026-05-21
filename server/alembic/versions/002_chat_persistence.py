"""Chat persistence: make card_id nullable, add workspace_id and mode

Revision ID: 002
Revises: 001
Create Date: 2026-05-21
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Make card_id nullable for free chat mode
    op.alter_column("ai_chats", "card_id", nullable=True)

    # Add workspace_id column
    op.add_column(
        "ai_chats",
        sa.Column("workspace_id", UUID(as_uuid=True), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True),
    )
    op.create_index("idx_ai_chats_workspace", "ai_chats", ["workspace_id"])

    # Add mode column
    op.add_column(
        "ai_chats",
        sa.Column("mode", sa.String(8), server_default="rag"),
    )


def downgrade() -> None:
    op.drop_column("ai_chats", "mode")
    op.drop_index("idx_ai_chats_workspace")
    op.drop_column("ai_chats", "workspace_id")
    op.alter_column("ai_chats", "card_id", nullable=False)
