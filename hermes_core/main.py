from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from hermes_core.database import engine, Base, AsyncSessionLocal
from hermes_core.routers import daily, submit, stats, progress, books, admin, audio_practice
import hermes_core.models  # noqa: F401 — enregistre tous les models pour create_all


async def _ensure_default_user():
    """Crée l'utilisateur par défaut s'il n'existe pas (système mono-utilisateur)."""
    from sqlalchemy import select
    from hermes_core.models.user import User
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).limit(1))
        if result.scalar_one_or_none():
            return
        user = User(
            username="alexi",
            cefr_level="A2+",
            grammar_scores={},
            vocabulary_mastery={},
            error_log=[],
        )
        db.add(user)
        await db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await _ensure_default_user()
    yield


app = FastAPI(title="Hermes", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(daily.router)
app.include_router(submit.router)
app.include_router(stats.router)
app.include_router(progress.router)
app.include_router(books.router)
app.include_router(admin.router)
app.include_router(audio_practice.router)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/status")
async def status():
    """Diagnostic : état du système (user, livres, progression)."""
    from sqlalchemy import select, func
    from hermes_core.models.user import User
    from hermes_core.models.book import Book
    from hermes_core.models.progress import ReadingProgress

    async with AsyncSessionLocal() as db:
        user = (await db.execute(select(User).limit(1))).scalar_one_or_none()
        books_total = (await db.execute(select(func.count(Book.id)))).scalar()
        books_parsed = (await db.execute(
            select(func.count(Book.id)).where(Book.parsed == True)  # noqa: E712
        )).scalar()
        progress_count = (await db.execute(select(func.count(ReadingProgress.id)))).scalar()

    return {
        "user": {"id": user.id, "username": user.username, "cefr": user.cefr_level} if user else None,
        "books": {"total": books_total, "parsed": books_parsed},
        "reading_progress_entries": progress_count,
        "ready": user is not None and books_parsed > 0 and progress_count > 0,
    }
