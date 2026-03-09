"""
Endpoint pour récupérer les sessions pré-générées du soir
et router vers un batch spécifique par ID.
"""
import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from hermes_core.database import get_db
from hermes_core.models.exercise import DailyBatch, Exercise
from hermes_core.models.book import Chapter, Book
from hermes_core.schemas.exercise import (
    NightlyPlanOut, NightlySessionOut, DailyBatchOut, ExerciseOut
)
from hermes_core.services.adaptation_engine import WEAK

router = APIRouter(prefix="/nightly", tags=["nightly"])

_TYPE_META = {
    "book_progress": ("📖 Book Progress", "Cross-chapter comprehension"),
    "vocab_flashcard": ("🃏 Vocab Flashcards", "Book vocabulary in context"),
    "grammar_drill": ("🎯 Grammar Drill", "Focused exercises"),
}

_PRIORITY_LABEL = {
    "weak": "Needs work",
    "review": "Review",
}


@router.get("/{user_id}", response_model=NightlyPlanOut)
async def get_nightly_plan(user_id: int, db: AsyncSession = Depends(get_db)):
    """Retourne les sessions pré-générées disponibles pour aujourd'hui."""
    today = datetime.date.today()

    result = await db.execute(
        select(DailyBatch)
        .where(DailyBatch.user_id == user_id)
        .where(DailyBatch.pre_generated == True)  # noqa: E712
        .where(DailyBatch.valid_for_date == today)
        .order_by(DailyBatch.batch_type, DailyBatch.grammar_focus)
    )
    batches = result.scalars().all()

    sessions = []
    for batch in batches:
        ex_result = await db.execute(
            select(Exercise).where(Exercise.batch_id == batch.id)
        )
        exercises = ex_result.scalars().all()
        count = len(exercises)

        emoji, base_desc = _TYPE_META.get(batch.batch_type, ("📚", "Session"))

        if batch.batch_type == "grammar_drill" and batch.grammar_focus:
            cat_display = batch.grammar_focus.replace("_", " ").title()
            title = f"{emoji} {cat_display}"
            description = f"{count} exercises · {base_desc}"
            # Déterminer la priorité depuis l'user (on passe par le batch_type)
            priority = _get_priority(batch.grammar_focus, exercises)
        else:
            chapter = await db.get(Chapter, batch.chapter_id)
            book = await db.get(Book, chapter.book_id) if chapter else None
            title = f"{emoji} {book.title if book else 'Book'}"
            description = f"{count} cross-chapter questions"
            priority = None

        sessions.append(NightlySessionOut(
            batch_id=batch.id,
            batch_type=batch.batch_type,
            grammar_focus=batch.grammar_focus,
            title=title,
            description=description,
            exercise_count=count,
            priority=priority,
        ))

    # Trier : book_progress → vocab_flashcard → grammar drills par priorité
    _ORDER = {"book_progress": 0, "vocab_flashcard": 1, "grammar_drill": 2}
    sessions.sort(key=lambda s: (
        _ORDER.get(s.batch_type, 3),
        0 if s.priority == "weak" else 1 if s.priority == "review" else 2,
        s.title,
    ))

    return NightlyPlanOut(
        valid_for_date=today.isoformat(),
        sessions=sessions,
    )


@router.get("/{user_id}/session/{batch_id}", response_model=DailyBatchOut)
async def get_nightly_session(user_id: int, batch_id: int, db: AsyncSession = Depends(get_db)):
    """Retourne un batch pré-généré spécifique sous le format DailyBatchOut standard."""
    batch = await db.get(DailyBatch, batch_id)
    if not batch or batch.user_id != user_id:
        raise HTTPException(404, "Session not found")

    result = await db.execute(
        select(Exercise).where(Exercise.batch_id == batch.id)
    )
    exercises = result.scalars().all()

    chapter = await db.get(Chapter, batch.chapter_id)
    book = await db.get(Book, chapter.book_id) if chapter else None

    comp = [ExerciseOut.model_validate(e) for e in exercises if e.type == "comprehension"]
    gram = [ExerciseOut.model_validate(e) for e in exercises if e.type == "grammar"]
    vocab = [ExerciseOut.model_validate(e) for e in exercises if e.type == "vocabulary"]

    scope_map = {
        "book_progress": "book",
        "vocab_flashcard": "vocabulary",
        "grammar_drill": "grammar_drill",
        "chapter": "chapter",
        "book": "book",
    }

    return DailyBatchOut(
        batch_id=batch.id,
        chapter_title=chapter.title or "" if chapter else "",
        book_title=book.title if book else "",
        comprehension=comp,
        grammar=gram,
        vocabulary=vocab,
        total_exercises=len(exercises),
        scope=scope_map.get(batch.batch_type, "chapter"),
        anecdotes=book.anecdotes or [] if book else [],
    )


def _get_priority(grammar_focus: str, exercises: list) -> str:
    """Déduit la priorité depuis le nombre d'exercices généré."""
    return "weak" if len(exercises) >= 6 else "review"
