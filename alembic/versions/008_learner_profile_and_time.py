"""add learner_profile to users and time_taken_ms to exercise_attempts

Revision ID: 008
Revises: 007
Create Date: 2026-03-07
"""
from alembic import op
import sqlalchemy as sa

revision = '008'
down_revision = '007'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS learner_profile TEXT"
    ))
    op.execute(sa.text(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS learner_profile_updated_at TIMESTAMP"
    ))
    op.execute(sa.text(
        "ALTER TABLE exercise_attempts ADD COLUMN IF NOT EXISTS time_taken_ms INTEGER"
    ))


def downgrade():
    op.drop_column('users', 'learner_profile')
    op.drop_column('users', 'learner_profile_updated_at')
    op.drop_column('exercise_attempts', 'time_taken_ms')
