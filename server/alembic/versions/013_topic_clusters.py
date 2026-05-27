"""topic clusters

Revision ID: 013_topic_clusters
Revises: 012_api_keys
Create Date: 2026-05-27
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "013_topic_clusters"
down_revision = "012_api_keys"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE topics (
            id UUID PRIMARY KEY,
            workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            name VARCHAR(128) NOT NULL DEFAULT '',
            centroid vector(768),
            card_count INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX idx_topics_workspace ON topics(workspace_id)")
    op.execute("CREATE INDEX idx_topics_centroid ON topics USING ivfflat (centroid vector_cosine_ops) WITH (lists = 50)")

    op.create_table(
        "topic_cards",
        sa.Column("topic_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("topics.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("card_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("cards.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("created_at", postgresql.TIMESTAMP(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_topic_cards_card", "topic_cards", ["card_id"], unique=True)


def downgrade() -> None:
    op.drop_table("topic_cards")
    op.execute("DROP TABLE IF EXISTS topics")
