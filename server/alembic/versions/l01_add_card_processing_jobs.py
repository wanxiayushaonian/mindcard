"""add card_processing_jobs

Revision ID: l01_add_card_processing_jobs
Revises: k01_structured_memory
Create Date: 2026-08-18
"""

from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "l01_add_card_processing_jobs"
down_revision: Union[str, None] = "k01_structured_memory"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "card_processing_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "card_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("default_chat_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("extraction_language", sa.String(8), nullable=False, server_default="zh"),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_cpj_status_updated", "card_processing_jobs", ["status", "updated_at"])
    op.create_index("ix_cpj_card_id", "card_processing_jobs", ["card_id"])
    op.create_index("ix_cpj_workspace_id", "card_processing_jobs", ["workspace_id"])


def downgrade() -> None:
    op.drop_index("ix_cpj_workspace_id", table_name="card_processing_jobs")
    op.drop_index("ix_cpj_card_id", table_name="card_processing_jobs")
    op.drop_index("ix_cpj_status_updated", table_name="card_processing_jobs")
    op.drop_table("card_processing_jobs")
