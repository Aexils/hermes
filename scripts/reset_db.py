"""
Remet la base de données à zéro : truncate toutes les tables + reset des séquences.
Recréé ensuite l'utilisateur par défaut (id=1).

Usage : python scripts/reset_db.py [username] [cefr_level]
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from hermes_core.database import AsyncSessionLocal
from hermes_core.models.user import User
from sqlalchemy import text


TABLES = [
    "exercise_attempts",
    "exercises",
    "daily_batches",
    "vocab_srs",
    "reading_progress",
    "tokens",
    "sentences",
    "chapters",
    "books",
    "users",
]


async def reset(username: str = "alexi", cefr_level: str = "B1"):
    async with AsyncSessionLocal() as db:
        print("Truncating tables and resetting sequences…")
        for table in TABLES:
            await db.execute(text(f"TRUNCATE TABLE {table} RESTART IDENTITY CASCADE"))
            print(f"  ✓ {table}")

        await db.commit()

        user = User(
            username=username,
            cefr_level=cefr_level,
            grammar_scores={},
            vocabulary_mastery={},
            error_log=[],
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        print(f"\nUser '{username}' created with id={user.id}, CEFR={cefr_level}.")
        print("\nDone. Clear your browser localStorage (key: hermes-session) to remove the stale resume banner.")


if __name__ == "__main__":
    username = sys.argv[1] if len(sys.argv) > 1 else "alexi"
    cefr_level = sys.argv[2] if len(sys.argv) > 2 else "B1"
    asyncio.run(reset(username, cefr_level))
