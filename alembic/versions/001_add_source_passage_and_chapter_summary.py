"""add source_passage and chapter summary

Revision ID: 001
Revises:
Create Date: 2026-03-06
"""
from alembic import op
import sqlalchemy as sa

revision = '001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text("ALTER TABLE exercises ADD COLUMN IF NOT EXISTS source_passage TEXT"))
    op.execute(sa.text("ALTER TABLE chapters ADD COLUMN IF NOT EXISTS summary TEXT"))


def downgrade():
    op.drop_column('exercises', 'source_passage')
    op.drop_column('chapters', 'summary')
