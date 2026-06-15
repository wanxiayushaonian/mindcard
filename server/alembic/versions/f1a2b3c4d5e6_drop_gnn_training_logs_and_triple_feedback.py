"""drop gnn_training_logs and triple_feedback tables

Revision ID: f1a2b3c4d5e6
Revises: a5f08e067557
Create Date: 2026-06-10 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, None] = 'a5f08e067557'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table('triple_feedback')
    op.drop_table('gnn_training_logs')


def downgrade() -> None:
    op.create_table(
        'gnn_training_logs',
        op.Column('id', op.sa.Uuid(), primary_key=True),
        op.Column('workspace_id', op.sa.Uuid(), op.ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False),
        op.Column('training_mode', op.sa.String(32), nullable=False),
        op.Column('graph_size_nodes', op.sa.Integer(), nullable=False),
        op.Column('graph_size_edges', op.sa.Integer(), nullable=False),
        op.Column('checkpoint_path', op.sa.Text(), nullable=False),
        op.Column('training_duration_seconds', op.sa.Integer(), nullable=True),
        op.Column('status', op.sa.String(32), nullable=False),
        op.Column('error_message', op.sa.Text(), nullable=True),
        op.Column('created_at', op.sa.TIMESTAMP(timezone=True)),
    )
    op.create_table(
        'triple_feedback',
        op.Column('id', op.sa.Uuid(), primary_key=True),
        op.Column('triple_id', op.sa.Uuid(), op.ForeignKey('graph_relations.id'), nullable=True),
        op.Column('user_id', op.sa.Uuid(), op.ForeignKey('users.id'), nullable=True),
        op.Column('feedback_type', op.sa.String(32), nullable=False),
        op.Column('corrected_head', op.sa.Text(), nullable=True),
        op.Column('corrected_relation', op.sa.String(128), nullable=True),
        op.Column('corrected_tail', op.sa.Text(), nullable=True),
        op.Column('created_at', op.sa.TIMESTAMP(timezone=True)),
    )
