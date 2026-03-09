from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from hermes_core.database import get_db
from hermes_core.models.book import Book, Chapter
from hermes_core.models.progress import ReadingProgress
from hermes_core.schemas.progress import ProgressOut, SyncResult

router = APIRouter(prefix="/progress", tags=["progress"])


@router.get("/{user_id}", response_model=list[ProgressOut])
async def get_progress(user_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Book)
        .join(Chapter, Chapter.book_id == Book.id)
        .join(ReadingProgress, ReadingProgress.chapter_id == Chapter.id)
        .where(ReadingProgress.user_id == user_id)
        .distinct()
    )
    books = result.scalars().all()

    output = []
    for book in books:
        total_result = await db.execute(
            select(func.count(Chapter.id)).where(Chapter.book_id == book.id)
        )
        total = total_result.scalar()

        completed_result = await db.execute(
            select(func.count(ReadingProgress.id))
            .join(Chapter, ReadingProgress.chapter_id == Chapter.id)
            .where(Chapter.book_id == book.id)
            .where(ReadingProgress.user_id == user_id)
        )
        completed = completed_result.scalar()

        output.append(ProgressOut(
            book_title=book.title,
            author=book.author,
            chapters_completed=completed,
            chapters_total=total,
            percent_complete=round(completed / total * 100, 1) if total else 0.0,
            last_read=None,
        ))
    return output


@router.post("/sync/booklore", response_model=SyncResult)
async def sync_booklore(db: AsyncSession = Depends(get_db)):
    """
    Synchronise la progression depuis Booklore.
    - Détecte les livres en cours de lecture
    - Calcule le chapitre courant via le pourcentage
    - Crée un ReadingProgress si le chapitre a avancé
    """
    from hermes_core.services.booklore_client import BookloreClient
    from hermes_core.models.book import Book, Chapter
    from hermes_core.models.progress import ReadingProgress

    client = BookloreClient()
    try:
        reading_books = await client.get_currently_reading()
    except Exception as e:
        raise HTTPException(500, f"Cannot reach Booklore: {e}")

    # Système mono-utilisateur : récupérer le premier utilisateur
    from hermes_core.models.user import User
    user_result = await db.execute(select(User).limit(1))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "No user found. Create a user first via scripts/seed_user.py")

    from hermes_core.services.epub_parser import EPUBParser
    from hermes_core.database import AsyncSessionLocal
    from pathlib import Path

    new_count = 0
    parsing_triggered = 0
    parsing_titles: list[str] = []

    for item in reading_books:
        # Trouver le livre en DB par path EPUB
        result = await db.execute(
            select(Book).where(Book.file_path == item["epub_path"])
        )
        book = result.scalar_one_or_none()

        if not book:
            # Livre pas encore en DB → créer et lancer le parsing en arrière-plan
            epub_path = item["epub_path"]
            if not Path(epub_path).exists():
                continue
            book = Book(
                title=item["title"],
                author=item["author"],
                file_path=epub_path,
                format="epub",
                parsed=False,
            )
            db.add(book)
            await db.flush()
            await db.commit()
            await db.refresh(book)
            # Parse en arrière-plan (tâche asynchrone)
            import asyncio
            from hermes_core.routers.books import _parse_and_store
            asyncio.create_task(_parse_and_store(book.id, epub_path))
            parsing_triggered += 1
            parsing_titles.append(item["title"])
            # Pas encore de chapitres → on reviendra au prochain sync
            continue

        if not book.parsed:
            # Parsing en cours, on attend le prochain sync
            continue

        # Récupérer les chapitres ordonnés
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

        # Vérifier si ce chapitre est déjà enregistré pour cet utilisateur
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
        new_count += 1

    await db.commit()
    return SyncResult(
        synced_from="booklore",
        new_chapters_detected=new_count,
        batches_queued=new_count + parsing_triggered,
        parsing_books=parsing_titles,
    )
