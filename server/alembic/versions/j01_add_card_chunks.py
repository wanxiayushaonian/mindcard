"""add card_chunks table for sub-card embeddings

Revision ID: j01_add_card_chunks
Revises: i01_add_depth_to_ai_chats
Create Date: 2026-06-15 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

from app.config import settings

revision: str = "j01_add_card_chunks"
down_revision: Union[str, None] = "i01_add_depth_to_ai_chats"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "card_chunks",
        sa.Column("id", PG_UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "card_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("chunk_text", sa.Text(), nullable=False),
        sa.Column("embedding", Vector(settings.embedding_dim), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_card_chunks_card_id_chunk_index",
        "card_chunks",
        ["card_id", "chunk_index"],
    )


def downgrade() -> None:
    op.drop_index("ix_card_chunks_card_id_chunk_index", table_name="card_chunks")
    op.drop_table("card_chunks")
