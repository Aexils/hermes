"""add nightly pre-generation fields to daily_batches

Revision ID: 005
Revises: 004
Create Date: 2026-03-06
"""
from alembic import op
import sqlalchemy as sa

revision = '005'
down_revision = '004'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text(
        "ALTER TABLE daily_batches ADD COLUMN IF NOT EXISTS batch_type VARCHAR NOT NULL DEFAULT 'chapter'"
    ))
    op.execute(sa.text(
        "ALTER TABLE daily_batches ADD COLUMN IF NOT EXISTS grammar_focus VARCHAR"
    ))
    op.execute(sa.text(
        "ALTER TABLE daily_batches ADD COLUMN IF NOT EXISTS pre_generated BOOLEAN NOT NULL DEFAULT false"
    ))
    op.execute(sa.text(
        "ALTER TABLE daily_batches ADD COLUMN IF NOT EXISTS valid_for_date DATE"
    ))
    op.execute(sa.text("""
        CREATE INDEX IF NOT EXISTS ix_daily_batches_nightly
        ON daily_batches (user_id, pre_generated, valid_for_date, batch_type)
    """))


def downgrade():
    op.drop_index('ix_daily_batches_nightly', table_name='daily_batches')
    op.drop_column('daily_batches', 'valid_for_date')
    op.drop_column('daily_batches', 'pre_generated')
    op.drop_column('daily_batches', 'grammar_focus')
    op.drop_column('daily_batches', 'batch_type')
