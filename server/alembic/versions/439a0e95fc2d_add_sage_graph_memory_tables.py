"""add sage graph memory tables

Revision ID: 439a0e95fc2d
Revises: 65055ac0cef1
Create Date: 2026-06-01 15:08:10.220195
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from pgvector.sqlalchemy import Vector

# revision identifiers, used by Alembic.
revision: str = '439a0e95fc2d'
down_revision: Union[str, None] = '65055ac0cef1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- graph_entities ---
    op.create_table(
        'graph_entities',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('workspace_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.Text(), nullable=False),
        sa.Column('entity_type', sa.String(64), nullable=True),
        sa.Column('embedding', Vector(768), nullable=True),
        sa.Column('access_count', sa.Integer(), server_default='0', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    )
    op.create_index('idx_graph_entities_workspace', 'graph_entities', ['workspace_id'])

    # --- graph_relations ---
    op.create_table(
        'graph_relations',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('workspace_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False),
        sa.Column('head_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('graph_entities.id', ondelete='CASCADE'), nullable=False),
        sa.Column('relation', sa.String(128), nullable=False),
        sa.Column('tail_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('graph_entities.id', ondelete='CASCADE'), nullable=False),
        sa.Column('weight', sa.Float(), server_default='1.0', nullable=False),
        sa.Column('source_card_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('cards.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    )
    op.create_index('idx_graph_relations_workspace', 'graph_relations', ['workspace_id'])
    op.create_index('idx_graph_relations_head', 'graph_relations', ['head_id'])
    op.create_index('idx_graph_relations_tail', 'graph_relations', ['tail_id'])

    # --- entity_cards (association table) ---
    op.create_table(
        'entity_cards',
        sa.Column('entity_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('graph_entities.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('card_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('cards.id', ondelete='CASCADE'), primary_key=True),
    )

    # --- gnn_training_logs ---
    op.create_table(
        'gnn_training_logs',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('workspace_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False),
        sa.Column('training_mode', sa.String(32), nullable=False),
        sa.Column('graph_size_nodes', sa.Integer(), nullable=False),
        sa.Column('graph_size_edges', sa.Integer(), nullable=False),
        sa.Column('checkpoint_path', sa.Text(), nullable=False),
        sa.Column('training_duration_seconds', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(32), nullable=False),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    )

    # --- triple_feedback ---
    op.create_table(
        'triple_feedback',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('triple_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('graph_relations.id'), nullable=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('users.id'), nullable=True),
        sa.Column('feedback_type', sa.String(32), nullable=False),
        sa.Column('corrected_head', sa.Text(), nullable=True),
        sa.Column('corrected_relation', sa.String(128), nullable=True),
        sa.Column('corrected_tail', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    )

    # --- add core_entity_ids to tree_nodes ---
    op.add_column('tree_nodes',
                  sa.Column('core_entity_ids', postgresql.ARRAY(postgresql.UUID(as_uuid=True)),
                            server_default='{}', nullable=True))


def downgrade() -> None:
    # --- remove core_entity_ids from tree_nodes ---
    op.drop_column('tree_nodes', 'core_entity_ids')

    # --- drop tables in reverse dependency order ---
    op.drop_table('triple_feedback')
    op.drop_table('gnn_training_logs')
    op.drop_table('entity_cards')
    op.drop_table('graph_relations')
    op.drop_table('graph_entities')
