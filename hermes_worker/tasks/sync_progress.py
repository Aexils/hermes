from hermes_worker.worker import app
import asyncio


@app.task
def sync_all_users():
    """Synchronise la progression Booklore pour tous les utilisateurs."""
    asyncio.run(_async_sync())


async def _async_sync():
    from sqlalchemy import select
    from hermes_core.database import AsyncSessionLocal
    from hermes_core.models.user import User
    from hermes_core.models.book import Book, Chapter
    from hermes_core.models.progress import ReadingProgress
    from hermes_core.services.booklore_client import BookloreClient

    client = BookloreClient()
    try:
        reading_books = await client.get_currently_reading()
    except Exception as e:
        print(f"[sync_progress] Cannot reach Booklore: {e}")
        return

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User))
        users = result.scalars().all()
        if not users:
            return

        # Système mono-utilisateur : on prend le premier utilisateur
        user = users[0]

        for item in reading_books:
            result = await db.execute(
                select(Book).where(Book.file_path == item["epub_path"])
            )
            book = result.scalar_one_or_none()
            if not book:
                continue

            result = await db.execute(
                select(Chapter)
                .where(Chapter.book_id == book.id)
                .order_by(Chapter.order_index)
            )
            chapters = result.scalars().all()
            if not chapters:
                continue

            current_chapter = client.progress_to_chapter(item["progress_percent"], chapters)
            if not current_chapter:
                continue

            existing = await db.execute(
                select(ReadingProgress)
                .where(ReadingProgress.chapter_id == current_chapter.id)
                .where(ReadingProgress.user_id == user.id)
            )
            if existing.scalar_one_or_none():
                continue

            db.add(ReadingProgress(
                user_id=user.id,
                chapter_id=current_chapter.id,
                source="booklore",
            ))

        await db.commit()
