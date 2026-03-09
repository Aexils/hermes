from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
from hermes_core.database import get_db
from hermes_core.models.user import User
from hermes_core.models.book import Chapter, Sentence, Token, Book
from hermes_core.models.exercise import DailyBatch, Exercise
from hermes_core.models.progress import ReadingProgress
from hermes_core.services.srs_engine import get_due_words
from hermes_core.schemas.exercise import DailyBatchOut, ExerciseOut
from hermes_core.services.exercise_generator import ExerciseGenerator
from hermes_core.config import get_settings
from hermes_llm.client import OllamaClient
import datetime

router = APIRouter(prefix="/daily", tags=["daily"])


async def _build_chapter_batch(
    user_id: int,
    chapter: Chapter,
    db: AsyncSession,
    grammar_count: int = 5,
    vocab_count: int = 8,
    comprehension_count: int = 7,
) -> tuple[DailyBatch, list[str]]:
    """Generate and persist a chapter-scoped exercise batch. Returns (batch, anecdotes)."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")

    book = await db.get(Book, chapter.book_id)

    result = await db.execute(
        select(Sentence).where(Sentence.chapter_id == chapter.id).order_by(Sentence.order_index)
    )
    sentences = result.scalars().all()
    chapter_text = " ".join(s.text for s in sentences)
    chapter_excerpt = chapter_text[:2000]

    result = await db.execute(
        select(Token)
        .join(Sentence)
        .where(Sentence.chapter_id == chapter.id)
        .where(Token.pos.in_(["NOUN", "VERB", "ADJ"]))
    )
    tokens = result.scalars().all()
    candidate_words = list({t.lemma for t in tokens if len(t.lemma) > 3})
    # Priorité 1 : mots SRS dont la révision est due
    due = await get_due_words(user_id, db, limit=10)
    due_in_chapter = [w for w in due if w in candidate_words]
    # Priorité 2 : mots peu maîtrisés
    others = sorted(
        [w for w in candidate_words if w not in due_in_chapter],
        key=lambda w: user.vocabulary_mastery.get(w, 0.0) if user.vocabulary_mastery else 0.0
    )
    target_words = (due_in_chapter + others)[:15]

    settings = get_settings()
    ollama = OllamaClient(settings.ollama_host, settings.ollama_model)
    generator = ExerciseGenerator(ollama)
    exercises_data = await generator.generate_daily_batch(
        user=user,
        chapter_text=chapter_text,
        chapter_excerpt=chapter_excerpt,
        target_words=target_words,
        chapter_title=chapter.title or "",
        book=book,
        db=db,
        grammar_count=grammar_count,
        vocab_count=vocab_count,
        comprehension_count=comprehension_count,
    )

    batch = DailyBatch(user_id=user_id, chapter_id=chapter.id, model_used=settings.ollama_model)
    db.add(batch)
    await db.flush()

    anecdotes = exercises_data.pop("anecdotes", [])

    for ex_type, items in exercises_data.items():
        for item in items:
            exercise = Exercise(
                type=ex_type,
                subtype=item.get("subtype", ""),
                question=item.get("question", ""),
                options=item.get("options"),
                correct_answer=item.get("correct_answer", ""),
                grammar_category=item.get("grammar_category"),
                vocabulary_item=item.get("vocabulary_item"),
                source_passage=item.get("source_passage"),
                source_chapter_id=chapter.id,
                batch_id=batch.id,
            )
            db.add(exercise)

    await db.commit()
    await db.refresh(batch)
    return batch, anecdotes


async def _get_or_generate_batch(user_id: int, db: AsyncSession) -> tuple[DailyBatch, list[str]]:
    """Default: today's batch from reading progress."""
    today = datetime.date.today()

    result = await db.execute(
        select(DailyBatch)
        .where(DailyBatch.user_id == user_id)
        .where(DailyBatch.generated_at >= datetime.datetime.combine(today, datetime.time.min))
        .order_by(DailyBatch.generated_at.desc())
    )
    batch = result.scalars().first()
    if batch:
        # Récupérer les anecdotes depuis le cache book
        chapter = await db.get(Chapter, batch.chapter_id)
        book = await db.get(Book, chapter.book_id) if chapter else None
        anecdotes = book.anecdotes or [] if book else []
        return batch, anecdotes

    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")

    result = await db.execute(
        select(ReadingProgress)
        .where(ReadingProgress.user_id == user_id)
        .order_by(ReadingProgress.completed_at.desc())
        .limit(1)
    )
    latest_progress = result.scalar_one_or_none()
    if not latest_progress:
        raise HTTPException(404, "No reading progress found. Sync from Booklore first.")

    chapter = await db.get(Chapter, latest_progress.chapter_id)
    if not chapter:
        raise HTTPException(404, "Chapter not found")

    return await _build_chapter_batch(user_id, chapter, db)


@router.get("/{user_id}", response_model=DailyBatchOut)
async def get_daily_batch(
    user_id: int,
    book_id: Optional[int] = Query(default=None),
    scope: str = Query(default="chapter"),
    chapter_id: Optional[int] = Query(default=None),
    grammar_count: Optional[int] = Query(default=None),
    vocab_count: Optional[int] = Query(default=None),
    comprehension_count: Optional[int] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    scope_out = scope

    anecdotes: list[str] = []

    if book_id is None:
        # Default behaviour: today's session from reading progress
        batch, anecdotes = await _get_or_generate_batch(user_id, db)
        scope_out = "chapter"
    elif scope == "book":
        # Whole-book mode — always generate fresh, no cache
        user = await db.get(User, user_id)
        if not user:
            raise HTTPException(404, "User not found")

        book = await db.get(Book, book_id)

        result = await db.execute(
            select(Chapter)
            .where(Chapter.book_id == book_id)
            .order_by(Chapter.order_index)
        )
        chapters = result.scalars().all()
        if not chapters:
            raise HTTPException(404, "No chapters found for this book")

        # Load sentences for each chapter
        sentences_by_chapter: dict = {}
        for ch in chapters:
            res = await db.execute(
                select(Sentence).where(Sentence.chapter_id == ch.id).order_by(Sentence.order_index)
            )
            sentences_by_chapter[ch.id] = res.scalars().all()

        settings = get_settings()
        ollama = OllamaClient(settings.ollama_host, settings.ollama_model)
        generator = ExerciseGenerator(ollama)
        exercises_data = await generator.generate_book_batch(
            user=user,
            book_id=book_id,
            chapters=chapters,
            sentences_by_chapter=sentences_by_chapter,
            db=db,
            book=book,
        )

        anecdotes = exercises_data.pop("anecdotes", [])
        first_chapter = chapters[0]
        batch = DailyBatch(user_id=user_id, chapter_id=first_chapter.id, model_used=settings.ollama_model)
        db.add(batch)
        await db.flush()

        for ex_type, items in exercises_data.items():
            for item in items:
                exercise = Exercise(
                    type=ex_type,
                    subtype=item.get("subtype", ""),
                    question=item.get("question", ""),
                    options=item.get("options"),
                    correct_answer=item.get("correct_answer", ""),
                    grammar_category=item.get("grammar_category"),
                    vocabulary_item=item.get("vocabulary_item"),
                    source_passage=item.get("source_passage"),
                    source_chapter_id=item.get("source_chapter_id", first_chapter.id),
                    batch_id=batch.id,
                )
                db.add(exercise)

        await db.commit()
        await db.refresh(batch)
        scope_out = "book"
    else:
        # Chapter scope with explicit book_id
        if chapter_id is not None:
            chapter = await db.get(Chapter, chapter_id)
            if not chapter or chapter.book_id != book_id:
                raise HTTPException(404, "Chapter not found in this book")
        else:
            # Most recent chapter of the book
            result = await db.execute(
                select(Chapter)
                .where(Chapter.book_id == book_id)
                .order_by(Chapter.order_index.desc())
                .limit(1)
            )
            chapter = result.scalar_one_or_none()
            if not chapter:
                raise HTTPException(404, "No chapters found for this book")

        batch, anecdotes = await _build_chapter_batch(
            user_id, chapter, db,
            grammar_count=grammar_count or 5,
            vocab_count=vocab_count or 8,
            comprehension_count=comprehension_count or 7,
        )
        scope_out = "chapter"

    # Load and return the batch
    result = await db.execute(
        select(Exercise).where(Exercise.batch_id == batch.id)
    )
    exercises = result.scalars().all()

    chapter = await db.get(Chapter, batch.chapter_id)
    book = await db.get(Book, chapter.book_id) if chapter else None

    comp = [ExerciseOut.model_validate(e) for e in exercises if e.type == "comprehension"]
    gram = [ExerciseOut.model_validate(e) for e in exercises if e.type == "grammar"]
    vocab = [ExerciseOut.model_validate(e) for e in exercises if e.type == "vocabulary"]

    return DailyBatchOut(
        batch_id=batch.id,
        chapter_title=chapter.title or "" if chapter else "",
        book_title=book.title if book else "",
        comprehension=comp,
        grammar=gram,
        vocabulary=vocab,
        total_exercises=len(exercises),
        scope=scope_out,
        anecdotes=anecdotes,
    )
