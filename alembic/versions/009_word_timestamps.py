"""add word_timestamps to sentences

Revision ID: 009
Revises: 008
Create Date: 2026-03-07
"""
from alembic import op
import sqlalchemy as sa

revision = '009'
down_revision = '008'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text(
        "ALTER TABLE sentences ADD COLUMN IF NOT EXISTS word_timestamps JSONB"
    ))


def downgrade():
    op.drop_column('sentences', 'word_timestamps')
