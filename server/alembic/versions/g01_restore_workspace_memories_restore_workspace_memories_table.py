"""restore workspace_memories table

Revision ID: g01_restore_workspace_memories
Revises: f82228b12b1f
Create Date: 2026-06-14 18:01:30.811256
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "g01_restore_workspace_memories"
down_revision: Union[str, None] = "f82228b12b1f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # f82228b12b1f mistakenly dropped workspace_memories in its upgrade path.
    # Recreate the table so the model and schema are back in sync.
    op.create_table(
        "workspace_memories",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "workspace_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("slug", sa.String(100), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column(
            "source_chat_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("ai_chats.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("updated_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id", name="workspace_memories_pkey"),
        sa.UniqueConstraint("workspace_id", "slug", name="uq_workspace_memory_slug"),
    )
    op.create_index(
        "idx_workspace_memories_workspace", "workspace_memories", ["workspace_id"]
    )


def downgrade() -> None:
    op.drop_index("idx_workspace_memories_workspace", table_name="workspace_memories")
    op.drop_table("workspace_memories")
