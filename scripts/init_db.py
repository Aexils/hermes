"""
Script d'initialisation de la base de données.
Crée toutes les tables via SQLAlchemy.

Usage : python scripts/init_db.py
"""
import asyncio
import sys
from pathlib import Path

# Ajouter la racine du projet au path
sys.path.insert(0, str(Path(__file__).parent.parent))

from hermes_core.database import engine, Base
import hermes_core.models  # noqa: F401


async def init():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("Database tables created successfully.")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(init())
