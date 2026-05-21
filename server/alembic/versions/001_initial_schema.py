"""Initial schema with pgvector

Revision ID: 001
Revises:
Create Date: 2026-05-21
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, ARRAY, TIMESTAMP

# revision identifiers, used by Alembic.
revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Enable pgvector extension
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # Enable Chinese text search configuration
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'chinese') THEN
                CREATE TEXT SEARCH CONFIGURATION chinese (parser = pg_catalog.default);
                ALTER TEXT SEARCH CONFIGURATION chinese
                    ADD MAPPING FOR asciiword, asciihword, hword_asciipart, word, hword, hword_part
                    WITH english_stem;
            END IF;
        END$$;
    """)

    # Users
    op.create_table(
        "users",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("wechat_openid", sa.String(64), unique=True, nullable=False),
        sa.Column("nickname", sa.String(64), server_default=""),
        sa.Column("avatar_url", sa.Text, server_default=""),
        sa.Column("created_at", TIMESTAMP(timezone=True), server_default=sa.text("NOW()")),
    )
    op.create_index("idx_users_openid", "users", ["wechat_openid"])

    # Workspaces
    op.create_table(
        "workspaces",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("local_id", sa.String(64), unique=True, nullable=False),
        sa.Column("owner_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("icon", sa.String(8), server_default="💡"),
        sa.Column("color", sa.String(16), server_default="#94B4C8"),
        sa.Column("invite_code", sa.String(8), unique=True, nullable=True),
        sa.Column("created_at", TIMESTAMP(timezone=True), server_default=sa.text("NOW()")),
    )
    op.create_index("idx_workspaces_local_id", "workspaces", ["local_id"])
    op.create_index("idx_workspaces_owner", "workspaces", ["owner_id"])

    # Workspace members
    op.create_table(
        "workspace_members",
        sa.Column("workspace_id", UUID(as_uuid=True), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("role", sa.String(16), server_default="editor"),
        sa.Column("joined_at", TIMESTAMP(timezone=True), server_default=sa.text("NOW()")),
    )

    # Cards
    op.create_table(
        "cards",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("local_id", sa.String(64), unique=True, nullable=False),
        sa.Column("workspace_id", UUID(as_uuid=True), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("creator_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("title", sa.String(128), server_default=""),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("keywords", ARRAY(sa.String), server_default="{}"),
        sa.Column("color", sa.String(16), server_default="#B8D4E3"),
        sa.Column("emotion_tag", sa.String(32), server_default=""),
        sa.Column("is_favorite", sa.Boolean, server_default="false"),
        sa.Column("is_temp", sa.Boolean, server_default="true"),
        sa.Column("created_at", TIMESTAMP(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("updated_at", TIMESTAMP(timezone=True), nullable=True),
    )
    op.create_index("idx_cards_local_id", "cards", ["local_id"])
    op.create_index("idx_cards_workspace", "cards", ["workspace_id"])
    op.create_index("idx_cards_keywords", "cards", ["keywords"], postgresql_using="gin")

    # Add pgvector embedding column and FTS vector
    op.execute("ALTER TABLE cards ADD COLUMN embedding vector(1024)")
    op.execute("ALTER TABLE cards ADD COLUMN fts_vector tsvector GENERATED ALWAYS AS (to_tsvector('chinese', coalesce(title, '') || ' ' || content)) STORED")
    op.execute("CREATE INDEX idx_cards_embedding ON cards USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)")
    op.execute("CREATE INDEX idx_cards_fts ON cards USING gin (fts_vector)")

    # Card relations
    op.create_table(
        "card_relations",
        sa.Column("card_id", UUID(as_uuid=True), sa.ForeignKey("cards.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("related_card_id", UUID(as_uuid=True), sa.ForeignKey("cards.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("relation_type", sa.String(16), primary_key=True),
        sa.Column("score", sa.Float, server_default="0"),
        sa.Column("created_at", TIMESTAMP(timezone=True), server_default=sa.text("NOW()")),
    )

    # AI chats
    op.create_table(
        "ai_chats",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("local_id", sa.String(64), unique=True, nullable=False),
        sa.Column("card_id", UUID(as_uuid=True), sa.ForeignKey("cards.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(128), server_default=""),
        sa.Column("created_at", TIMESTAMP(timezone=True), server_default=sa.text("NOW()")),
    )
    op.create_index("idx_ai_chats_local_id", "ai_chats", ["local_id"])
    op.create_index("idx_ai_chats_card", "ai_chats", ["card_id"])

    # Chat messages
    op.create_table(
        "chat_messages",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("chat_id", UUID(as_uuid=True), sa.ForeignKey("ai_chats.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(8), nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("created_at", TIMESTAMP(timezone=True), server_default=sa.text("NOW()")),
    )
    op.execute("ALTER TABLE chat_messages ADD COLUMN embedding vector(1024)")
    op.create_index("idx_chat_messages_chat", "chat_messages", ["chat_id"])

    # Comments
    op.create_table(
        "comments",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("card_id", UUID(as_uuid=True), sa.ForeignKey("cards.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("created_at", TIMESTAMP(timezone=True), server_default=sa.text("NOW()")),
    )
    op.create_index("idx_comments_card", "comments", ["card_id"])


def downgrade() -> None:
    op.drop_table("comments")
    op.drop_table("chat_messages")
    op.drop_table("ai_chats")
    op.drop_table("card_relations")
    op.drop_table("cards")
    op.drop_table("workspace_members")
    op.drop_table("workspaces")
    op.drop_table("users")
    op.execute("DROP EXTENSION IF EXISTS vector")
