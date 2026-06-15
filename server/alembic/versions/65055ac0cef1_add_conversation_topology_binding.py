"""add conversation topology binding

Revision ID: 65055ac0cef1
Revises: b2c3d4e5f6a7
Create Date: 2026-06-01 11:07:43.671621
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '65055ac0cef1'
down_revision: Union[str, None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add tree_node_id to ai_chats
    op.add_column('ai_chats', sa.Column('tree_node_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key('fk_ai_chats_tree_node_id', 'ai_chats', 'tree_nodes', ['tree_node_id'], ['id'], ondelete='SET NULL')
    op.create_index('ix_ai_chats_tree_node_id', 'ai_chats', ['tree_node_id'])

    # Add chat_id to tree_nodes
    op.add_column('tree_nodes', sa.Column('chat_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key('fk_tree_nodes_chat_id', 'tree_nodes', 'ai_chats', ['chat_id'], ['id'], ondelete='SET NULL')
    op.create_index('ix_tree_nodes_chat_id', 'tree_nodes', ['chat_id'])


def downgrade() -> None:
    op.drop_index('ix_tree_nodes_chat_id', table_name='tree_nodes')
    op.drop_constraint('fk_tree_nodes_chat_id', 'tree_nodes', type_='foreignkey')
    op.drop_column('tree_nodes', 'chat_id')

    op.drop_index('ix_ai_chats_tree_node_id', table_name='ai_chats')
    op.drop_constraint('fk_ai_chats_tree_node_id', 'ai_chats', type_='foreignkey')
    op.drop_column('ai_chats', 'tree_node_id')
