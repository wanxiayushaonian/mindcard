"""merge tree_nodes into ai_chats

Revision ID: 015_merge_tree_nodes
Revises: 014_fork_system
Create Date: 2026-06-05
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from pgvector.sqlalchemy import Vector

revision = "015_merge_tree_nodes"
down_revision = "014_fork_system"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add TreeNode fields to ai_chats
    op.add_column("ai_chats", sa.Column("parent_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_ai_chats_parent_id", "ai_chats", "ai_chats",
        ["parent_id"], ["id"], ondelete="CASCADE"
    )
    op.create_index("ix_ai_chats_parent_id", "ai_chats", ["parent_id"])

    op.add_column("ai_chats", sa.Column("node_type", sa.String(20), server_default="branch"))
    op.add_column("ai_chats", sa.Column("description", sa.Text(), server_default=""))
    op.add_column("ai_chats", sa.Column("summary", sa.Text(), server_default=""))
    op.add_column("ai_chats", sa.Column("chat_status", sa.String(20), server_default="active"))
    op.add_column("ai_chats", sa.Column("sort_order", sa.Integer(), server_default="0"))
    op.add_column("ai_chats", sa.Column("embedding", Vector(1024), nullable=True))
    op.add_column("ai_chats", sa.Column("extra", postgresql.JSONB(), server_default="{}"))
    op.add_column("ai_chats", sa.Column("core_entity_ids", postgresql.ARRAY(postgresql.UUID(as_uuid=True)), server_default="{}"))
    op.add_column("ai_chats", sa.Column("updated_at", postgresql.TIMESTAMP(timezone=True), nullable=True))
    op.add_column("ai_chats", sa.Column("completed_at", postgresql.TIMESTAMP(timezone=True), nullable=True))

    # 2. Migrate data from tree_nodes to ai_chats
    # For each chat with a tree_node_id, copy the tree_node's fields over
    op.execute("""
        UPDATE ai_chats ac SET
            node_type = tn.node_type,
            description = tn.description,
            summary = tn.summary,
            chat_status = tn.status,
            sort_order = tn.sort_order,
            embedding = tn.embedding,
            extra = tn.extra,
            core_entity_ids = tn.core_entity_ids,
            updated_at = tn.updated_at,
            completed_at = tn.completed_at
        FROM tree_nodes tn
        WHERE ac.tree_node_id = tn.id
    """)

    # Migrate parent_id: find the parent tree_node's chat_id
    op.execute("""
        UPDATE ai_chats ac SET
            parent_id = parent_ac.id
        FROM tree_nodes tn
        JOIN tree_nodes parent_tn ON parent_tn.id = tn.parent_id
        JOIN ai_chats parent_ac ON parent_ac.tree_node_id = parent_tn.id
        WHERE ac.tree_node_id = tn.id
          AND tn.parent_id IS NOT NULL
    """)

    # 3. Add chat_id to node_cards for future use
    op.add_column("node_cards", sa.Column("chat_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_node_cards_chat_id", "node_cards", "ai_chats",
        ["chat_id"], ["id"], ondelete="CASCADE"
    )
    op.create_index("ix_node_cards_chat_id", "node_cards", ["chat_id"])

    # Populate node_cards.chat_id from tree_nodes
    op.execute("""
        UPDATE node_cards nc SET chat_id = ac.id
        FROM tree_nodes tn
        JOIN ai_chats ac ON ac.tree_node_id = tn.id
        WHERE nc.node_id = tn.id
    """)

    # 4. Composite index for topology queries
    op.create_index("ix_ai_chats_workspace_parent", "ai_chats", ["workspace_id", "parent_id"])


def downgrade() -> None:
    op.drop_index("ix_ai_chats_workspace_parent", table_name="ai_chats")
    op.drop_index("ix_node_cards_chat_id", table_name="node_cards")
    op.drop_constraint("fk_node_cards_chat_id", "node_cards", type_="foreignkey")
    op.drop_column("node_cards", "chat_id")

    op.drop_index("ix_ai_chats_parent_id", table_name="ai_chats")
    op.drop_constraint("fk_ai_chats_parent_id", "ai_chats", type_="foreignkey")

    for col in ["parent_id", "node_type", "description", "summary", "chat_status",
                "sort_order", "embedding", "extra", "core_entity_ids", "updated_at", "completed_at"]:
        op.drop_column("ai_chats", col)
