"""add parent_chat_id to ai_chats

Revision ID: 71bc9814c07d
Revises: 2e4760fd4f94
Create Date: 2026-05-28 20:12:19.218950
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '71bc9814c07d'
down_revision: Union[str, None] = '2e4760fd4f94'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('ai_chats', sa.Column('parent_chat_id', sa.UUID(), nullable=True))
    op.create_index(op.f('ix_ai_chats_parent_chat_id'), 'ai_chats', ['parent_chat_id'], unique=False)
    op.create_foreign_key(None, 'ai_chats', 'ai_chats', ['parent_chat_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    op.drop_constraint(None, 'ai_chats', type_='foreignkey')
    op.drop_index(op.f('ix_ai_chats_parent_chat_id'), table_name='ai_chats')
    op.drop_column('ai_chats', 'parent_chat_id')
