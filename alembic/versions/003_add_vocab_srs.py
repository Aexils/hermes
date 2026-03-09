"""add vocab_srs table

Revision ID: 003
Revises: 002
Create Date: 2026-03-06
"""
from alembic import op
import sqlalchemy as sa

revision = '003'
down_revision = '002'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS vocab_srs (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            word VARCHAR NOT NULL,
            interval INTEGER NOT NULL DEFAULT 1,
            repetitions INTEGER NOT NULL DEFAULT 0,
            easiness FLOAT NOT NULL DEFAULT 2.5,
            next_review TIMESTAMP NOT NULL DEFAULT now(),
            last_reviewed TIMESTAMP,
            CONSTRAINT uq_user_word UNIQUE (user_id, word)
        )
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_vocab_srs_user_next ON vocab_srs (user_id, next_review)"
    ))


def downgrade():
    op.drop_index('ix_vocab_srs_user_next', table_name='vocab_srs')
    op.drop_table('vocab_srs')
