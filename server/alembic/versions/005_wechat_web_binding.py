"""Add wechat_web_openid and wechat_unionid for web OAuth binding

Revision ID: 005
Revises: 004
Create Date: 2026-05-22
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("wechat_web_openid", sa.String(64), nullable=True))
    op.create_index("ix_users_wechat_web_openid", "users", ["wechat_web_openid"], unique=True)

    op.add_column("users", sa.Column("wechat_unionid", sa.String(64), nullable=True))
    op.create_index("ix_users_wechat_unionid", "users", ["wechat_unionid"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_wechat_unionid", table_name="users")
    op.drop_column("users", "wechat_unionid")
    op.drop_index("ix_users_wechat_web_openid", table_name="users")
    op.drop_column("users", "wechat_web_openid")
