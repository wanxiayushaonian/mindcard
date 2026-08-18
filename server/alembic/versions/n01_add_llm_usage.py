"""add llm_usage_daily

Revision ID: n01_add_llm_usage
Revises: m01_add_embedding_model
Create Date: 2026-08-19

Tracks per-user daily LLM token usage for quota enforcement.
"""

from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "n01_add_llm_usage"
down_revision: Union[str, None] = "m01_add_embedding_model"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "llm_usage_daily",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("usage_date", sa.Date(), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("user_id", "usage_date", name="uq_llm_usage_user_date"),
    )
    op.create_index("ix_llm_usage_daily_user_id", "llm_usage_daily", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_llm_usage_daily_user_id", table_name="llm_usage_daily")
    op.drop_table("llm_usage_daily")
