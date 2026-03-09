from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, cast, Date as SADate, text
from typing import Optional
from pydantic import BaseModel
from hermes_core.database import get_db
from hermes_core.models.user import User
from hermes_core.models.book import Chapter, Sentence, Book, Token
from hermes_core.models.exercise import DailyBatch, Exercise, ExerciseAttempt
from hermes_core.models.progress import ReadingProgress
from hermes_core.models.srs import VocabSRS
from hermes_core.services.exercise_generator import ExerciseGenerator
from hermes_core.config import get_settings
from hermes_llm.client import OllamaClient
import datetime

router = APIRouter(prefix="/admin", tags=["admin"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class AdminBatchOut(BaseModel):
    id: int
    generated_at: datetime.datetime
    batch_type: str
    grammar_focus: Optional[str]
    model_used: Optional[str]
    book_title: str
    chapter_title: str
    cefr_level: str
    exercise_count: int
    comprehension_count: int
    grammar_count: int
    vocabulary_count: int
    pre_generated: bool
    valid_for_date: Optional[datetime.date]

    model_config = {"from_attributes": True}


class AdminOverviewOut(BaseModel):
    total_batches: int
    batches_today: int
    total_exercises: int
    models_used: dict[str, int]
    batches_by_type: dict[str, int]
    user: dict


class GeneratePayload(BaseModel):
    batch_type: str = "grammar_drill"
    grammar_focus: Optional[str] = None
    chapter_ids: list[int]


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _enrich_batch(batch: DailyBatch, db: AsyncSession) -> AdminBatchOut:
    chapter = await db.get(Chapter, batch.chapter_id)
    book = await db.get(Book, chapter.book_id) if chapter else None

    result = await db.execute(
        select(Exercise).where(Exercise.batch_id == batch.id)
    )
    exercises = result.scalars().all()

    user = await db.get(User, batch.user_id)

    return AdminBatchOut(
        id=batch.id,
        generated_at=batch.generated_at,
        batch_type=batch.batch_type or "chapter",
        grammar_focus=batch.grammar_focus,
        model_used=batch.model_used,
        book_title=book.title if book else "(unknown)",
        chapter_title=chapter.title or f"Chapter {batch.chapter_id}" if chapter else "(unknown)",
        cefr_level=user.cefr_level if user else "?",
        exercise_count=len(exercises),
        comprehension_count=sum(1 for e in exercises if e.type == "comprehension"),
        grammar_count=sum(1 for e in exercises if e.type == "grammar"),
        vocabulary_count=sum(1 for e in exercises if e.type == "vocabulary"),
        pre_generated=batch.pre_generated or False,
        valid_for_date=batch.valid_for_date,
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/batches", response_model=list[AdminBatchOut])
async def list_batches(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(DailyBatch).order_by(DailyBatch.generated_at.desc()).limit(50)
    )
    batches = result.scalars().all()
    return [await _enrich_batch(b, db) for b in batches]


@router.get("/overview", response_model=AdminOverviewOut)
async def get_overview(db: AsyncSession = Depends(get_db)):
    today = datetime.date.today()
    today_start = datetime.datetime.combine(today, datetime.time.min)

    total_batches = (await db.execute(select(func.count(DailyBatch.id)))).scalar() or 0
    batches_today = (await db.execute(
        select(func.count(DailyBatch.id)).where(DailyBatch.generated_at >= today_start)
    )).scalar() or 0
    total_exercises = (await db.execute(select(func.count(Exercise.id)))).scalar() or 0

    # Models used
    rows = (await db.execute(
        select(DailyBatch.model_used, func.count(DailyBatch.id))
        .where(DailyBatch.model_used.isnot(None))
        .group_by(DailyBatch.model_used)
    )).all()
    models_used = {row[0]: row[1] for row in rows}

    # Batches by type
    type_rows = (await db.execute(
        select(DailyBatch.batch_type, func.count(DailyBatch.id))
        .where(DailyBatch.batch_type.isnot(None))
        .group_by(DailyBatch.batch_type)
    )).all()
    batches_by_type = {row[0]: row[1] for row in type_rows}

    user = (await db.execute(select(User).limit(1))).scalar_one_or_none()
    user_info = {
        "cefr_level": user.cefr_level if user else "?",
        "cefr_streak": getattr(user, "cefr_streak", 0) or 0,
    }

    return AdminOverviewOut(
        total_batches=total_batches,
        batches_today=batches_today,
        total_exercises=total_exercises,
        models_used=models_used,
        batches_by_type=batches_by_type,
        user=user_info,
    )


@router.post("/generate", response_model=AdminBatchOut)
async def generate_batch(payload: GeneratePayload, db: AsyncSession = Depends(get_db)):
    if not payload.chapter_ids:
        raise HTTPException(400, "chapter_ids must not be empty")

    user = (await db.execute(select(User).limit(1))).scalar_one_or_none()
    if not user:
        raise HTTPException(404, "No user found")

    # Collect sentences from all requested chapters
    all_sentences: list[str] = []
    first_chapter: Optional[Chapter] = None
    for cid in payload.chapter_ids:
        chapter = await db.get(Chapter, cid)
        if not chapter:
            raise HTTPException(404, f"Chapter {cid} not found")
        if first_chapter is None:
            first_chapter = chapter
        result = await db.execute(
            select(Sentence).where(Sentence.chapter_id == cid).order_by(Sentence.order_index)
        )
        all_sentences.extend(s.text for s in result.scalars().all())

    chapter_text = " ".join(all_sentences)
    chapter_excerpt = chapter_text[:2000]

    settings = get_settings()
    ollama = OllamaClient(settings.ollama_host, settings.ollama_model)
    generator = ExerciseGenerator(ollama)

    exercises_data = await generator.generate_daily_batch(
        user=user,
        chapter_text=chapter_text,
        chapter_excerpt=chapter_excerpt,
        target_words=[],
        chapter_title=first_chapter.title or "",
        book=await db.get(Book, first_chapter.book_id),
        db=db,
    )

    exercises_data.pop("anecdotes", None)

    batch = DailyBatch(
        user_id=user.id,
        chapter_id=first_chapter.id,
        batch_type=payload.batch_type,
        grammar_focus=payload.grammar_focus,
        pre_generated=True,
        valid_for_date=datetime.date.today(),
        model_used=settings.ollama_model,
    )
    db.add(batch)
    await db.flush()

    for ex_type, items in exercises_data.items():
        for item in items:
            db.add(Exercise(
                type=ex_type,
                subtype=item.get("subtype", ""),
                question=item.get("question", ""),
                options=item.get("options"),
                correct_answer=item.get("correct_answer", ""),
                grammar_category=item.get("grammar_category"),
                vocabulary_item=item.get("vocabulary_item"),
                source_passage=item.get("source_passage"),
                source_chapter_id=first_chapter.id,
                batch_id=batch.id,
            ))

    await db.commit()
    await db.refresh(batch)
    return await _enrich_batch(batch, db)


@router.delete("/batches/{batch_id}")
async def delete_batch(batch_id: int, db: AsyncSession = Depends(get_db)):
    batch = await db.get(DailyBatch, batch_id)
    if not batch:
        raise HTTPException(404, "Batch not found")
    # Delete associated exercises first
    result = await db.execute(select(Exercise).where(Exercise.batch_id == batch_id))
    for ex in result.scalars().all():
        await db.delete(ex)
    await db.delete(batch)
    await db.commit()
    return {"deleted": batch_id}


# ── DB CRUD Schemas ───────────────────────────────────────────────────────────

class ExerciseRow(BaseModel):
    id: int
    batch_id: Optional[int]
    type: str
    subtype: Optional[str]
    question: str
    correct_answer: str
    options: Optional[list]
    grammar_category: Optional[str]
    vocabulary_item: Optional[str]
    book_title: str
    chapter_title: str


class ExercisePatch(BaseModel):
    question: Optional[str] = None
    correct_answer: Optional[str] = None
    options: Optional[list] = None
    grammar_category: Optional[str] = None
    vocabulary_item: Optional[str] = None


class BookRow(BaseModel):
    id: int
    title: str
    author: Optional[str]
    parsed: bool
    transcribed: bool
    transcription_status: str
    audio_item_id: Optional[str] = None
    audio_path: Optional[str] = None


class BookPatch(BaseModel):
    title: Optional[str] = None
    author: Optional[str] = None
    parsed: Optional[bool] = None
    audio_item_id: Optional[str] = None
    audio_path: Optional[str] = None


class ChapterRow(BaseModel):
    id: int
    book_id: int
    book_title: str
    title: Optional[str]
    order_index: int


class ChapterPatch(BaseModel):
    title: Optional[str] = None
    order_index: Optional[int] = None


class UserRow(BaseModel):
    id: int
    username: str
    cefr_level: str
    cefr_streak: int
    grammar_scores: dict
    vocabulary_mastery: dict
    created_at: Optional[datetime.datetime] = None


class UserPatch(BaseModel):
    cefr_level: Optional[str] = None
    cefr_streak: Optional[int] = None
    grammar_scores: Optional[dict] = None
    vocabulary_mastery: Optional[dict] = None


class UserCreate(BaseModel):
    username: str
    cefr_level: str = "B1"


class ResetScoresPayload(BaseModel):
    grammar: bool = True
    vocabulary: bool = True


class UserDetailStats(BaseModel):
    total_exercises: int
    exercises_correct: int
    success_rate: float
    last_active: Optional[datetime.datetime]
    active_days: int
    created_at: Optional[datetime.datetime]


class AttemptRow(BaseModel):
    id: int
    exercise_id: int
    question: str
    user_answer: Optional[str]
    is_correct: bool
    attempted_at: datetime.datetime


# ── DB CRUD Helpers ───────────────────────────────────────────────────────────

async def _exercise_to_row(ex: Exercise, db: AsyncSession) -> ExerciseRow:
    batch = await db.get(DailyBatch, ex.batch_id) if ex.batch_id else None
    chapter = await db.get(Chapter, batch.chapter_id) if batch and batch.chapter_id else None
    book = await db.get(Book, chapter.book_id) if chapter else None
    return ExerciseRow(
        id=ex.id,
        batch_id=ex.batch_id,
        type=ex.type or "",
        subtype=ex.subtype,
        question=ex.question or "",
        correct_answer=ex.correct_answer or "",
        options=ex.options,
        grammar_category=ex.grammar_category,
        vocabulary_item=ex.vocabulary_item,
        book_title=book.title if book else "(unknown)",
        chapter_title=chapter.title or f"Ch. {chapter.order_index + 1}" if chapter else "(unknown)",
    )


# ── DB CRUD Endpoints — Exercises ─────────────────────────────────────────────

@router.get("/db/exercises", response_model=list[ExerciseRow])
async def list_db_exercises(
    batch_id: Optional[int] = None,
    type: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    q = select(Exercise)
    if batch_id is not None:
        q = q.where(Exercise.batch_id == batch_id)
    if type is not None:
        q = q.where(Exercise.type == type)
    q = q.order_by(Exercise.id.desc()).limit(limit).offset(offset)
    exercises = (await db.execute(q)).scalars().all()
    return [await _exercise_to_row(ex, db) for ex in exercises]


@router.patch("/db/exercises/{exercise_id}")
async def patch_db_exercise(exercise_id: int, payload: ExercisePatch, db: AsyncSession = Depends(get_db)):
    ex = await db.get(Exercise, exercise_id)
    if not ex:
        raise HTTPException(404, "Exercise not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(ex, field, value)
    await db.commit()
    return {"updated": exercise_id}


@router.delete("/db/exercises/{exercise_id}")
async def delete_db_exercise(exercise_id: int, db: AsyncSession = Depends(get_db)):
    ex = await db.get(Exercise, exercise_id)
    if not ex:
        raise HTTPException(404, "Exercise not found")
    attempts = (await db.execute(select(ExerciseAttempt).where(ExerciseAttempt.exercise_id == exercise_id))).scalars().all()
    for a in attempts:
        await db.delete(a)
    await db.delete(ex)
    await db.commit()
    return {"deleted": exercise_id}


# ── Flag question ─────────────────────────────────────────────────────────────

class FlagPayload(BaseModel):
    reason: str = "Ambiguous: multiple valid answers reported by user"

@router.post("/flag-question/{exercise_id}")
async def flag_question(
    exercise_id: int,
    payload: FlagPayload,
    db: AsyncSession = Depends(get_db),
):
    """Signalement manuel d'une question ambiguë → écrit dans quality_logger."""
    ex = await db.get(Exercise, exercise_id)
    if not ex:
        raise HTTPException(404, "Exercise not found")
    from hermes_core.services.quality_logger import QuestionQualityLogger
    logger = QuestionQualityLogger()
    logger.record(
        question=ex.question,
        source_passage=ex.source_passage or "",
        passed=False,
        reason=f"[USER FLAG] {payload.reason}",
    )
    logger.log_stats()
    return {"flagged": exercise_id, "question": ex.question}


# ── DB CRUD Endpoints — Books ─────────────────────────────────────────────────

@router.get("/db/books", response_model=list[BookRow])
async def list_db_books(db: AsyncSession = Depends(get_db)):
    books = (await db.execute(select(Book).order_by(Book.id))).scalars().all()
    return [
        BookRow(
            id=b.id, title=b.title, author=b.author,
            parsed=b.parsed or False, transcribed=b.transcribed or False,
            transcription_status=b.transcription_status or "none",
            audio_item_id=b.audio_item_id,
            audio_path=b.audio_path,
        )
        for b in books
    ]


@router.patch("/db/books/{book_id}")
async def patch_db_book(book_id: int, payload: BookPatch, db: AsyncSession = Depends(get_db)):
    book = await db.get(Book, book_id)
    if not book:
        raise HTTPException(404, "Book not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(book, field, value)
    await db.commit()
    return {"updated": book_id}


@router.delete("/db/books/{book_id}")
async def delete_db_book(book_id: int, db: AsyncSession = Depends(get_db)):
    book = await db.get(Book, book_id)
    if not book:
        raise HTTPException(404, "Book not found")
    chapters = (await db.execute(select(Chapter).where(Chapter.book_id == book_id))).scalars().all()
    for chapter in chapters:
        # Nullify DailyBatch references
        for batch in (await db.execute(select(DailyBatch).where(DailyBatch.chapter_id == chapter.id))).scalars().all():
            batch.chapter_id = None
        # Nullify exercise source_chapter_id
        for ex in (await db.execute(select(Exercise).where(Exercise.source_chapter_id == chapter.id))).scalars().all():
            ex.source_chapter_id = None
        # Delete tokens → sentences
        for s in (await db.execute(select(Sentence).where(Sentence.chapter_id == chapter.id))).scalars().all():
            for tok in (await db.execute(select(Token).where(Token.sentence_id == s.id))).scalars().all():
                await db.delete(tok)
            await db.delete(s)
        await db.delete(chapter)
    await db.delete(book)
    await db.commit()
    return {"deleted": book_id}


# ── DB CRUD Endpoints — Chapters ──────────────────────────────────────────────

@router.get("/db/chapters", response_model=list[ChapterRow])
async def list_db_chapters(book_id: Optional[int] = None, db: AsyncSession = Depends(get_db)):
    q = select(Chapter)
    if book_id is not None:
        q = q.where(Chapter.book_id == book_id)
    chapters = (await db.execute(q.order_by(Chapter.book_id, Chapter.order_index))).scalars().all()
    rows = []
    for ch in chapters:
        book = await db.get(Book, ch.book_id)
        rows.append(ChapterRow(
            id=ch.id, book_id=ch.book_id,
            book_title=book.title if book else "(unknown)",
            title=ch.title, order_index=ch.order_index or 0,
        ))
    return rows


@router.patch("/db/chapters/{chapter_id}")
async def patch_db_chapter(chapter_id: int, payload: ChapterPatch, db: AsyncSession = Depends(get_db)):
    chapter = await db.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(404, "Chapter not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(chapter, field, value)
    await db.commit()
    return {"updated": chapter_id}


@router.delete("/db/chapters/{chapter_id}")
async def delete_db_chapter(chapter_id: int, db: AsyncSession = Depends(get_db)):
    chapter = await db.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(404, "Chapter not found")
    for batch in (await db.execute(select(DailyBatch).where(DailyBatch.chapter_id == chapter_id))).scalars().all():
        batch.chapter_id = None
    for ex in (await db.execute(select(Exercise).where(Exercise.source_chapter_id == chapter_id))).scalars().all():
        ex.source_chapter_id = None
    for s in (await db.execute(select(Sentence).where(Sentence.chapter_id == chapter_id))).scalars().all():
        for tok in (await db.execute(select(Token).where(Token.sentence_id == s.id))).scalars().all():
            await db.delete(tok)
        await db.delete(s)
    await db.delete(chapter)
    await db.commit()
    return {"deleted": chapter_id}


# ── DB CRUD Endpoints — Users ─────────────────────────────────────────────────

@router.get("/db/users", response_model=list[UserRow])
async def list_db_users(db: AsyncSession = Depends(get_db)):
    users = (await db.execute(select(User).order_by(User.id))).scalars().all()
    return [
        UserRow(
            id=u.id, username=u.username, cefr_level=u.cefr_level or "B1",
            cefr_streak=u.cefr_streak or 0,
            grammar_scores=u.grammar_scores or {},
            vocabulary_mastery=u.vocabulary_mastery or {},
            created_at=u.created_at,
        )
        for u in users
    ]


@router.post("/db/users", response_model=UserRow)
async def create_db_user(payload: UserCreate, db: AsyncSession = Depends(get_db)):
    existing = (await db.execute(select(User).where(User.username == payload.username))).scalar_one_or_none()
    if existing:
        raise HTTPException(400, "Username already exists")
    user = User(
        username=payload.username,
        cefr_level=payload.cefr_level,
        grammar_scores={},
        vocabulary_mastery={},
        error_log=[],
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return UserRow(
        id=user.id, username=user.username, cefr_level=user.cefr_level or "B1",
        cefr_streak=user.cefr_streak or 0,
        grammar_scores=user.grammar_scores or {},
        vocabulary_mastery=user.vocabulary_mastery or {},
        created_at=user.created_at,
    )


@router.get("/db/users/{user_id}/stats", response_model=UserDetailStats)
async def get_user_stats(user_id: int, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")

    total = (await db.execute(
        select(func.count(ExerciseAttempt.id)).where(ExerciseAttempt.user_id == user_id)
    )).scalar() or 0

    correct = (await db.execute(
        select(func.count(ExerciseAttempt.id))
        .where(ExerciseAttempt.user_id == user_id, ExerciseAttempt.is_correct.is_(True))
    )).scalar() or 0

    last_active = (await db.execute(
        select(ExerciseAttempt.attempted_at)
        .where(ExerciseAttempt.user_id == user_id)
        .order_by(ExerciseAttempt.attempted_at.desc())
        .limit(1)
    )).scalar_one_or_none()

    active_days = (await db.execute(
        select(func.count(func.distinct(cast(ExerciseAttempt.attempted_at, SADate))))
        .where(ExerciseAttempt.user_id == user_id)
    )).scalar() or 0

    return UserDetailStats(
        total_exercises=total,
        exercises_correct=correct,
        success_rate=correct / total if total > 0 else 0.0,
        last_active=last_active,
        active_days=active_days,
        created_at=user.created_at,
    )


@router.post("/db/users/{user_id}/reset-scores")
async def reset_user_scores(user_id: int, payload: ResetScoresPayload, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if payload.grammar:
        user.grammar_scores = {}
    if payload.vocabulary:
        user.vocabulary_mastery = {}
    await db.commit()
    return {"reset": True}


@router.patch("/db/users/{user_id}")
async def patch_db_user(user_id: int, payload: UserPatch, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    await db.commit()
    return {"updated": user_id}


@router.delete("/db/users/{user_id}")
async def delete_db_user(user_id: int, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    # Delete exercise attempts
    for a in (await db.execute(select(ExerciseAttempt).where(ExerciseAttempt.user_id == user_id))).scalars().all():
        await db.delete(a)
    # Delete vocab SRS entries
    for v in (await db.execute(select(VocabSRS).where(VocabSRS.user_id == user_id))).scalars().all():
        await db.delete(v)
    # Delete reading progress
    for rp in (await db.execute(select(ReadingProgress).where(ReadingProgress.user_id == user_id))).scalars().all():
        await db.delete(rp)
    # Nullify daily batches
    for batch in (await db.execute(select(DailyBatch).where(DailyBatch.user_id == user_id))).scalars().all():
        batch.user_id = None
    await db.delete(user)
    await db.commit()
    return {"deleted": user_id}


# ── DB CRUD Endpoints — Attempts ──────────────────────────────────────────────

@router.get("/db/attempts", response_model=list[AttemptRow])
async def list_db_attempts(limit: int = 50, offset: int = 0, db: AsyncSession = Depends(get_db)):
    attempts = (await db.execute(
        select(ExerciseAttempt).order_by(ExerciseAttempt.id.desc()).limit(limit).offset(offset)
    )).scalars().all()
    rows = []
    for a in attempts:
        ex = await db.get(Exercise, a.exercise_id)
        rows.append(AttemptRow(
            id=a.id, exercise_id=a.exercise_id,
            question=ex.question if ex else "(deleted)",
            user_answer=a.user_answer,
            is_correct=a.is_correct or False,
            attempted_at=a.attempted_at,
        ))
    return rows


class ResetDbPayload(BaseModel):
    username: str = "alexi"
    cefr_level: str = "B1"


_RESET_TABLES = [
    "exercise_attempts", "exercises", "daily_batches",
    "vocab_srs", "reading_progress", "tokens", "sentences",
    "chapters", "books", "users",
]


@router.post("/db/reset")
async def reset_database(payload: ResetDbPayload, db: AsyncSession = Depends(get_db)):
    for table in _RESET_TABLES:
        await db.execute(text(f"TRUNCATE TABLE {table} RESTART IDENTITY CASCADE"))
    await db.commit()

    user = User(
        username=payload.username,
        cefr_level=payload.cefr_level,
        grammar_scores={},
        vocabulary_mastery={},
        error_log=[],
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return {"reset": True, "user_id": user.id, "username": user.username}


@router.delete("/db/attempts/{attempt_id}")
async def delete_db_attempt(attempt_id: int, db: AsyncSession = Depends(get_db)):
    attempt = await db.get(ExerciseAttempt, attempt_id)
    if not attempt:
        raise HTTPException(404, "Attempt not found")
    await db.delete(attempt)
    await db.commit()
    return {"deleted": attempt_id}
