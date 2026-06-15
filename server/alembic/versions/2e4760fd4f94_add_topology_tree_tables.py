"""add topology tree tables

Revision ID: 2e4760fd4f94
Revises: e178e0eb827f
Create Date: 2026-05-28 18:32:20.475549
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '2e4760fd4f94'
down_revision: Union[str, None] = 'e178e0eb827f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('tree_nodes',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('workspace_id', sa.UUID(), nullable=False),
        sa.Column('parent_id', sa.UUID(), nullable=True),
        sa.Column('node_type', sa.String(length=20), nullable=False, server_default='branch'),
        sa.Column('title', sa.String(length=256), nullable=False, server_default=''),
        sa.Column('description', sa.Text(), nullable=False, server_default=''),
        sa.Column('summary', sa.Text(), nullable=False, server_default=''),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='active'),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('extra', postgresql.JSONB(), nullable=False, server_default='{}'),
        sa.Column('created_at', postgresql.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.Column('completed_at', postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['parent_id'], ['tree_nodes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_tree_nodes_parent_id', 'tree_nodes', ['parent_id'])
    op.create_index('ix_tree_nodes_workspace_id', 'tree_nodes', ['workspace_id'])

    op.create_table('node_cards',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('node_id', sa.UUID(), nullable=False),
        sa.Column('card_id', sa.UUID(), nullable=False),
        sa.Column('created_at', postgresql.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['card_id'], ['cards.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['node_id'], ['tree_nodes.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('node_id', 'card_id', name='uq_node_cards_node_card')
    )
    op.create_index('ix_node_cards_card_id', 'node_cards', ['card_id'])
    op.create_index('ix_node_cards_node_id', 'node_cards', ['node_id'])

    op.create_table('node_refs',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('source_node_id', sa.UUID(), nullable=False),
        sa.Column('target_node_id', sa.UUID(), nullable=False),
        sa.Column('ref_type', sa.String(length=20), nullable=False, server_default='related'),
        sa.Column('reason', sa.Text(), nullable=False, server_default=''),
        sa.Column('created_at', postgresql.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['source_node_id'], ['tree_nodes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['target_node_id'], ['tree_nodes.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('source_node_id', 'target_node_id', name='uq_node_refs_source_target')
    )
    op.create_index('ix_node_refs_source_node_id', 'node_refs', ['source_node_id'])
    op.create_index('ix_node_refs_target_node_id', 'node_refs', ['target_node_id'])


def downgrade() -> None:
    op.drop_table('node_refs')
    op.drop_table('node_cards')
    op.drop_table('tree_nodes')
