"""add is_demo flag to workspaces

Revision ID: o01_add_is_demo_to_workspaces
Revises: n01_add_llm_usage
Create Date: 2026-08-19

Marks example-data workspaces (e.g. the seeded demo knowledge forest) so the
register endpoint can auto-grant membership to every new user.
"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "o01_add_is_demo_to_workspaces"
down_revision: Union[str, None] = "n01_add_llm_usage"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("workspaces", sa.Column("is_demo", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("workspaces", "is_demo")
