"""Increase chat_messages role column length

Revision ID: 003
Revises: 002
Create Date: 2026-05-21
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("chat_messages", "role", type_=sa.String(16))


def downgrade() -> None:
    op.alter_column("chat_messages", "role", type_=sa.String(8))
