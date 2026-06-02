"""add fork_id to chat_messages

Revision ID: 264554558dd8
Revises: dd0a6ac7871c
Create Date: 2026-06-02 13:46:47.346943
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '264554558dd8'
down_revision: Union[str, None] = 'dd0a6ac7871c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('chat_messages', sa.Column('fork_id', sa.String(length=64), nullable=True))
    op.create_index(op.f('ix_chat_messages_fork_id'), 'chat_messages', ['fork_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_chat_messages_fork_id'), table_name='chat_messages')
    op.drop_column('chat_messages', 'fork_id')
