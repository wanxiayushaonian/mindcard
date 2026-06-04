"""add fork system tables and metadata column

Revision ID: 014_fork_system
Revises: a5f08e067557
Create Date: 2026-06-04
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "014_fork_system"
down_revision = "a5f08e067557"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add metadata column to chat_messages
    op.add_column("chat_messages", sa.Column("metadata", postgresql.JSON(astext_type=sa.Text()), nullable=True))

    # 2. Create branch_insights table
    op.create_table(
        "branch_insights",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("source_chat_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("ai_chats.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_chat_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("ai_chats.id", ondelete="CASCADE"), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("consumed", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", postgresql.TIMESTAMP(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_branch_insights_target", "branch_insights", ["target_chat_id", "consumed"])

    # 3. Create workspace_memories table
    op.create_table(
        "workspace_memories",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("slug", sa.String(100), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("source_chat_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("ai_chats.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_at", postgresql.TIMESTAMP(timezone=True)),
        sa.Column("created_at", postgresql.TIMESTAMP(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("workspace_id", "slug", name="uq_workspace_memory_slug"),
    )
    op.create_index("idx_workspace_memories_workspace", "workspace_memories", ["workspace_id"])


def downgrade() -> None:
    op.drop_table("workspace_memories")
    op.drop_table("branch_insights")
    op.drop_column("chat_messages", "metadata")
