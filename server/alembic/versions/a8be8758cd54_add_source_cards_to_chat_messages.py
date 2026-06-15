"""add source_cards to chat_messages

Revision ID: a8be8758cd54
Revises: 5f5a74582dfe
Create Date: 2026-06-09 10:35:47.197393
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'a8be8758cd54'
down_revision: Union[str, None] = '5f5a74582dfe'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('chat_messages', sa.Column('source_cards', postgresql.JSON(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column('chat_messages', 'source_cards')
