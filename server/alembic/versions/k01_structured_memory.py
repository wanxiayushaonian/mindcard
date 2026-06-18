"""structured memory fields

Revision ID: k01_structured_memory
Revises: j01_add_card_chunks
Create Date: 2026-06-18 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects.postgresql import ARRAY, UUID as PG_UUID

from app.config import settings

revision: str = "k01_structured_memory"
down_revision: Union[str, None] = "j01_add_card_chunks"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "workspace_memories",
        sa.Column("memory_type", sa.String(20), nullable=False, server_default="fact"),
    )
    op.add_column(
        "workspace_memories",
        sa.Column("confidence", sa.Float(), nullable=False, server_default="1.0"),
    )
    op.add_column(
        "workspace_memories",
        sa.Column("importance", sa.Float(), nullable=False, server_default="0.5"),
    )
    op.add_column(
        "workspace_memories",
        sa.Column(
            "source_card_ids",
            ARRAY(PG_UUID(as_uuid=True)),
            nullable=False,
            server_default="{}",
        ),
    )
    op.add_column(
        "workspace_memories",
        sa.Column("embedding", Vector(settings.embedding_dim), nullable=True),
    )
    op.add_column(
        "workspace_memories",
        sa.Column("last_accessed_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("workspace_memories", "last_accessed_at")
    op.drop_column("workspace_memories", "embedding")
    op.drop_column("workspace_memories", "source_card_ids")
    op.drop_column("workspace_memories", "importance")
    op.drop_column("workspace_memories", "confidence")
    op.drop_column("workspace_memories", "memory_type")
