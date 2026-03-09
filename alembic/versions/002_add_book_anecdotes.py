"""add book anecdotes cache

Revision ID: 002
Revises: 001
Create Date: 2026-03-06
"""
from alembic import op
import sqlalchemy as sa

revision = '002'
down_revision = '001'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text("ALTER TABLE books ADD COLUMN IF NOT EXISTS anecdotes JSONB"))


def downgrade():
    op.drop_column('books', 'anecdotes')
