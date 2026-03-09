"""
Génération nocturne de sessions pré-calculées.

Pour chaque utilisateur :
1. Trouve le livre en cours + chapitre N-1 (sécurité : pas forcément fini)
2. Génère un batch book_progress (compréhension cross-chapitres jusqu'à N-1)
3. Pour chaque catégorie grammaticale non maîtrisée :
   - score < 0.5  → 6 exercices (priorité haute)
   - score 0.5-0.8 → 4 exercices (révision)
   - score >= 0.8  → skip (maîtrisé)
4. Idempotent : ne régénère pas si le batch du jour existe déjà
"""
import asyncio
import datetime
import logging

from hermes_worker.worker import app

log = logging.getLogger(__name__)


@app.task(bind=True, max_retries=2, default_retry_delay=300)
def run_nightly_generation(self):
    try:
        asyncio.run(_nightly())
    except Exception as exc:
        log.exception("Nightly generation failed")
        raise self.retry(exc=exc)


# ─────────────────────────────────────────────────────────────────────────────

async def _nightly():
    from sqlalchemy import select
    from hermes_core.database import AsyncSessionLocal
    from hermes_core.models.user import User

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User))
        users = result.scalars().all()

    for user in users:
        try:
            async with AsyncSessionLocal() as db:
                await _generate_for_user(user.id, db)
        except Exception:
            log.exception(f"Nightly generation failed for user {user.id}")


async def _generate_for_user(user_id: int, db):
    import datetime as dt
    from sqlalchemy import select
    from hermes_core.models.user import User
    from hermes_core.models.book import Book, Chapter, Sentence
    from hermes_core.models.exercise import DailyBatch, Exercise
    from hermes_core.models.progress import ReadingProgress
    from hermes_core.services.adaptation_engine import AdaptationEngine, GRAMMAR_CATEGORIES, MASTERED, WEAK
    from hermes_core.services.book_summarizer import get_or_generate_summary
    from hermes_core.services.book_anecdotes import get_or_generate_anecdotes
    from hermes_llm.prompts.comprehension_book import build_book_comprehension_prompt
    from hermes_llm.prompts.grammar_drill import build_grammar_drill_prompt
    from hermes_llm.client import OllamaClient
    from hermes_core.config import get_settings

    settings = get_settings()
    ollama = OllamaClient(settings.ollama_host, settings.ollama_model)
    adapter = AdaptationEngine()
    today = dt.date.today()

    user = await db.get(User, user_id)
    if not user:
        return

    # ── Dernier chapitre lu ──────────────────────────────────────────────────
    result = await db.execute(
        select(ReadingProgress)
        .where(ReadingProgress.user_id == user_id)
        .order_by(ReadingProgress.completed_at.desc())
        .limit(1)
    )
    latest = result.scalar_one_or_none()
    if not latest:
        log.info(f"User {user_id}: no reading progress, skipping nightly gen")
        return

    current_chapter = await db.get(Chapter, latest.chapter_id)
    if not current_chapter:
        return

    book = await db.get(Book, current_chapter.book_id)
    if not book:
        return

    # Chapitre cible = N-1 (sécurité si le chapitre en cours n'est pas fini)
    target_index = max(0, current_chapter.order_index - 1)

    result = await db.execute(
        select(Chapter)
        .where(Chapter.book_id == book.id)
        .where(Chapter.order_index <= target_index)
        .order_by(Chapter.order_index)
    )
    chapters = result.scalars().all()
    if not chapters:
        # Premier chapitre : utiliser le chapitre courant directement
        chapters = [current_chapter]

    log.info(f"User {user_id}: nightly gen for '{book.title}', {len(chapters)} chapters")

    # ── Anecdotes (cache) ────────────────────────────────────────────────────
    await get_or_generate_anecdotes(book, db, ollama)

    # ── Context textuel (derniers 3 chapitres, max 3000 chars chacun) ────────
    recent_chapters = chapters[-3:]
    book_context_parts = []
    for ch in recent_chapters:
        result = await db.execute(
            select(Sentence).where(Sentence.chapter_id == ch.id).order_by(Sentence.order_index)
        )
        sents = result.scalars().all()
        text = " ".join(s.text for s in sents)[:4000]
        book_context_parts.append(f"[{ch.title or f'Chapter {ch.order_index}'}]\n{text}")
    book_context = "\n\n".join(book_context_parts)

    # ── Résumés par chapitre ─────────────────────────────────────────────────
    book_summaries = []
    for ch in chapters:
        result = await db.execute(
            select(Sentence).where(Sentence.chapter_id == ch.id).order_by(Sentence.order_index)
        )
        sents = result.scalars().all()
        summary = await get_or_generate_summary(ch, sents, db, ollama)
        book_summaries.append({
            "chapter_index": ch.order_index,
            "title": ch.title or f"Chapter {ch.order_index}",
            "summary": summary,
        })

    # ── 1. Book progress batch ───────────────────────────────────────────────
    await _gen_book_progress(
        user, book, chapters, book_summaries, today, ollama, db
    )

    # ── 2. Vocab flashcards ──────────────────────────────────────────────────
    await _gen_vocab_flashcards(user, recent_chapters, today, ollama, db)

    # ── 3. Grammar drills ────────────────────────────────────────────────────
    # Les appels LLM sont lancés en parallèle ; la persistance reste séquentielle.
    grammar_scores = user.grammar_scores or {}
    error_log = user.error_log or []

    await _gen_grammar_drills_parallel(
        user, book, grammar_scores, error_log, book_context, today, ollama, db
    )

    # ── 4. Profil apprenant ───────────────────────────────────────────────────
    from hermes_core.services.learner_profile import refresh_profile_if_needed
    await refresh_profile_if_needed(user, ollama, db, after_session=False)

    await db.commit()
    log.info(f"User {user_id}: nightly gen complete")


async def _already_generated(user_id, batch_type, grammar_focus, today, db) -> bool:
    """Idempotence : vérifie si ce batch a déjà été généré aujourd'hui."""
    from sqlalchemy import select
    from hermes_core.models.exercise import DailyBatch

    q = (
        select(DailyBatch)
        .where(DailyBatch.user_id == user_id)
        .where(DailyBatch.pre_generated == True)  # noqa: E712
        .where(DailyBatch.valid_for_date == today)
        .where(DailyBatch.batch_type == batch_type)
    )
    if grammar_focus:
        q = q.where(DailyBatch.grammar_focus == grammar_focus)

    result = await db.execute(q)
    return result.scalar_one_or_none() is not None


async def _persist_batch(user_id, chapter_id, batch_type, grammar_focus,
                         today, exercises_data, ollama, db) -> None:
    """Crée le DailyBatch + Exercise rows en DB."""
    from hermes_core.models.exercise import DailyBatch, Exercise

    batch = DailyBatch(
        user_id=user_id,
        chapter_id=chapter_id,
        batch_type=batch_type,
        grammar_focus=grammar_focus,
        pre_generated=True,
        valid_for_date=today,
    )
    db.add(batch)
    await db.flush()

    for ex_type, items in exercises_data.items():
        if ex_type == "anecdotes":
            continue
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
                source_chapter_id=item.get("source_chapter_id", chapter_id),
                batch_id=batch.id,
            )
            db.add(exercise)


async def _gen_vocab_flashcards(user, chapters, today, ollama, db) -> None:
    from sqlalchemy import select
    from hermes_core.models.book import Sentence
    from hermes_llm.prompts.vocab_flashcard import build_vocab_flashcard_prompt
    import random as _random

    if await _already_generated(user.id, "vocab_flashcard", None, today, db):
        log.info(f"User {user.id}: vocab_flashcard already generated, skip")
        return

    sentences: list[str] = []
    for ch in chapters:
        result = await db.execute(
            select(Sentence).where(Sentence.chapter_id == ch.id).order_by(Sentence.order_index)
        )
        sentences.extend(s.text for s in result.scalars().all())

    if len(sentences) < 10:
        log.info(f"User {user.id}: too few sentences for vocab flashcards, skip")
        return

    sample = _random.sample(sentences, min(60, len(sentences)))
    prompt = build_vocab_flashcard_prompt(user.cefr_level, sample, n_exercises=15)
    data = await ollama.generate_json(prompt, temperature=0.5)
    exercises = data.get("exercises", [])

    anchor_chapter = chapters[-1]
    await _persist_batch(
        user.id, anchor_chapter.id, "vocab_flashcard", None, today,
        {"vocabulary": exercises}, ollama, db,
    )
    log.info(f"User {user.id}: vocab_flashcard batch created ({len(exercises)} ex)")


async def _gen_book_progress(user, book, chapters, book_summaries,
                              today, ollama, db) -> None:
    if await _already_generated(user.id, "book_progress", None, today, db):
        log.info(f"User {user.id}: book_progress already generated, skip")
        return

    prompt = build_book_comprehension_prompt(user.cefr_level, book_summaries, n_questions=8)
    data = await ollama.generate_json(prompt, temperature=0.7)
    exercises = data.get("exercises", [])

    index_to_id = {c.order_index: c.id for c in chapters}
    for ex in exercises:
        idx = ex.pop("source_chapter_index", None)
        if idx is not None:
            ex["source_chapter_id"] = index_to_id.get(idx, chapters[-1].id)

    await _persist_batch(
        user.id, chapters[-1].id, "book_progress", None, today,
        {"comprehension": exercises}, ollama, db
    )
    log.info(f"User {user.id}: book_progress batch created ({len(exercises)} ex)")


async def _gen_grammar_drills_parallel(
    user, book, grammar_scores, error_log, book_context, today, ollama, db
) -> None:
    """
    Parallélise les appels LLM pour toutes les catégories grammaticales non maîtrisées.
    Étape 1 : tous les appels LLM en asyncio.gather().
    Étape 2 : persistance séquentielle (une seule session DB).
    """
    from hermes_llm.prompts.grammar_drill import build_grammar_drill_prompt
    from hermes_core.models.book import Chapter
    from sqlalchemy import select

    # Récupérer le premier chapitre comme anchor
    result = await db.execute(
        select(Chapter).where(Chapter.book_id == book.id).order_by(Chapter.order_index).limit(1)
    )
    first_chapter = result.scalar_one_or_none()

    # Construire la liste des catégories à générer
    pending: list[tuple[str, int, list]] = []
    for category in GRAMMAR_CATEGORIES:
        score = grammar_scores.get(category, 0.0)
        if score >= MASTERED:
            continue
        if await _already_generated(user.id, "grammar_drill", category, today, db):
            log.info(f"User {user.id}: grammar_drill/{category} already generated, skip")
            continue
        n_ex = 6 if score < WEAK else 4
        gram_errors = [e for e in error_log if e.get("category") == category][-4:]
        pending.append((category, n_ex, gram_errors))

    if not pending:
        return

    # Étape 1 : tous les appels LLM en parallèle
    async def _call_llm(category: str, n_ex: int, gram_errors: list):
        prompt = build_grammar_drill_prompt(
            cefr_level=user.cefr_level,
            category=category,
            n_exercises=n_ex,
            book_context=book_context,
            error_examples=gram_errors or None,
        )
        return await ollama.generate_json(prompt, temperature=0.2)

    results = await asyncio.gather(
        *[_call_llm(cat, n, errs) for cat, n, errs in pending],
        return_exceptions=True,
    )

    # Étape 2 : persistance séquentielle
    for (category, n_ex, _), data in zip(pending, results):
        if isinstance(data, Exception):
            log.warning(f"User {user.id}: grammar_drill/{category} LLM failed: {data}")
            continue
        exercises = data.get("exercises", [])
        await _persist_batch(
            user.id, first_chapter.id if first_chapter else None,
            "grammar_drill", category, today,
            {"grammar": exercises}, ollama, db,
        )
        log.info(f"User {user.id}: grammar_drill/{category} batch created ({len(exercises)} ex)")


