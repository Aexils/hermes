"""add model_used to daily_batches

Revision ID: 007
Revises: 006
Create Date: 2026-03-07
"""
from alembic import op
import sqlalchemy as sa

revision = '007'
down_revision = '006'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text(
        "ALTER TABLE daily_batches ADD COLUMN IF NOT EXISTS model_used VARCHAR"
    ))


def downgrade():
    op.drop_column('daily_batches', 'model_used')
