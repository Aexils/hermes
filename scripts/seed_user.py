"""
Crée l'utilisateur par défaut (système mono-utilisateur).

Usage : python scripts/seed_user.py [username] [cefr_level]
Exemple : python scripts/seed_user.py alexi B2
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from hermes_core.database import AsyncSessionLocal
from hermes_core.models.user import User
from sqlalchemy import select


async def seed(username: str = "alexi", cefr_level: str = "B1"):
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.username == username))
        existing = result.scalar_one_or_none()
        if existing:
            print(f"User '{username}' already exists (id={existing.id}).")
            return

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
        print(f"User '{username}' created with id={user.id}, CEFR={cefr_level}.")


if __name__ == "__main__":
    username = sys.argv[1] if len(sys.argv) > 1 else "alexi"
    cefr_level = sys.argv[2] if len(sys.argv) > 2 else "B1"
    asyncio.run(seed(username, cefr_level))
