"""Drop tree_nodes table and legacy columns.

Revision ID: 016_drop_tree_nodes
Revises: 015_merge_tree_nodes
Create Date: 2026-06-04
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "016_drop_tree_nodes"
down_revision = "015_merge_tree_nodes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop legacy columns from ai_chats
    op.drop_index("ix_ai_chats_tree_node_id", table_name="ai_chats")
    op.drop_column("ai_chats", "tree_node_id")
    op.drop_index("ix_ai_chats_parent_chat_id", table_name="ai_chats")
    op.drop_column("ai_chats", "parent_chat_id")

    # Migrate node_cards: drop node_id, keep chat_id
    op.drop_index("ix_node_cards_node_id", table_name="node_cards")
    op.drop_constraint("node_cards_node_id_fkey", "node_cards", type_="foreignkey")
    op.drop_column("node_cards", "node_id")

    # Migrate node_refs: replace source_node_id/target_node_id with source_chat_id/target_chat_id
    op.drop_index("ix_node_refs_source_node_id", table_name="node_refs")
    op.drop_index("ix_node_refs_target_node_id", table_name="node_refs")
    op.drop_constraint("node_refs_source_node_id_fkey", "node_refs", type_="foreignkey")
    op.drop_constraint("node_refs_target_node_id_fkey", "node_refs", type_="foreignkey")
    op.drop_column("node_refs", "source_node_id")
    op.drop_column("node_refs", "target_node_id")

    op.add_column("node_refs", sa.Column("source_chat_id", UUID(as_uuid=True), sa.ForeignKey("ai_chats.id", ondelete="CASCADE"), nullable=False, index=True))
    op.add_column("node_refs", sa.Column("target_chat_id", UUID(as_uuid=True), sa.ForeignKey("ai_chats.id", ondelete="CASCADE"), nullable=False, index=True))

    # Drop tree_nodes table
    op.drop_table("tree_nodes")


def downgrade() -> None:
    # Recreate tree_nodes table
    op.create_table(
        "tree_nodes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("workspace_id", UUID(as_uuid=True), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), index=True),
        sa.Column("parent_id", UUID(as_uuid=True), sa.ForeignKey("tree_nodes.id", ondelete="CASCADE"), index=True, nullable=True),
        sa.Column("chat_id", UUID(as_uuid=True), sa.ForeignKey("ai_chats.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("core_entity_ids", sa.dialects.postgresql.ARRAY(UUID(as_uuid=True)), server_default="{}"),
        sa.Column("node_type", sa.String(20), server_default="branch"),
        sa.Column("title", sa.String(256), server_default=""),
        sa.Column("description", sa.Text, server_default=""),
        sa.Column("summary", sa.Text, server_default=""),
        sa.Column("status", sa.String(20), server_default="active"),
        sa.Column("sort_order", sa.Integer, server_default="0"),
        sa.Column("embedding", sa.Text, nullable=True),  # pgvector Vector type
        sa.Column("extra", sa.dialects.postgresql.JSONB, server_default="{}"),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("completed_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )

    # Restore node_refs columns
    op.drop_column("node_refs", "source_chat_id")
    op.drop_column("node_refs", "target_chat_id")
    op.add_column("node_refs", sa.Column("source_node_id", UUID(as_uuid=True), sa.ForeignKey("tree_nodes.id", ondelete="CASCADE"), nullable=False, index=True))
    op.add_column("node_refs", sa.Column("target_node_id", UUID(as_uuid=True), sa.ForeignKey("tree_nodes.id", ondelete="CASCADE"), nullable=False, index=True))

    # Restore node_cards.node_id
    op.add_column("node_cards", sa.Column("node_id", UUID(as_uuid=True), sa.ForeignKey("tree_nodes.id", ondelete="CASCADE"), nullable=False, index=True))

    # Restore ai_chats legacy columns
    op.add_column("ai_chats", sa.Column("parent_chat_id", UUID(as_uuid=True), sa.ForeignKey("ai_chats.id", ondelete="SET NULL"), nullable=True, index=True))
    op.add_column("ai_chats", sa.Column("tree_node_id", UUID(as_uuid=True), sa.ForeignKey("tree_nodes.id", ondelete="SET NULL"), nullable=True, index=True))
