"""add cefr session streak for consistent level-up

Revision ID: 004
Revises: 003
Create Date: 2026-03-06
"""
from alembic import op
import sqlalchemy as sa

revision = '004'
down_revision = '003'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS cefr_streak INTEGER NOT NULL DEFAULT 0"
    ))


def downgrade():
    op.drop_column('users', 'cefr_streak')
