"""audiobookshelf audio fields

Revision ID: 006
Revises: 005
Create Date: 2026-03-06
"""
from alembic import op
import sqlalchemy as sa

revision = '006'
down_revision = '005'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text("ALTER TABLE books ADD COLUMN IF NOT EXISTS audio_item_id VARCHAR"))
    op.execute(sa.text("ALTER TABLE books ADD COLUMN IF NOT EXISTS audio_path TEXT"))
    op.execute(sa.text(
        "ALTER TABLE books ADD COLUMN IF NOT EXISTS transcribed BOOLEAN NOT NULL DEFAULT false"
    ))
    op.execute(sa.text(
        "ALTER TABLE books ADD COLUMN IF NOT EXISTS transcription_status VARCHAR NOT NULL DEFAULT 'none'"
    ))
    op.execute(sa.text("ALTER TABLE sentences ADD COLUMN IF NOT EXISTS audio_start FLOAT"))
    op.execute(sa.text("ALTER TABLE sentences ADD COLUMN IF NOT EXISTS audio_end FLOAT"))
    op.execute(sa.text("ALTER TABLE sentences ADD COLUMN IF NOT EXISTS audio_file_index INTEGER"))


def downgrade():
    op.drop_column('books', 'audio_item_id')
    op.drop_column('books', 'audio_path')
    op.drop_column('books', 'transcribed')
    op.drop_column('books', 'transcription_status')
    op.drop_column('sentences', 'audio_start')
    op.drop_column('sentences', 'audio_end')
    op.drop_column('sentences', 'audio_file_index')
