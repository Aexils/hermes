from hermes_worker.worker import app
import asyncio


@app.task(bind=True, max_retries=3, default_retry_delay=60)
def generate_batch_for_user(self, user_id: int, chapter_id: int):
    """
    Tâche Celery déclenchée après détection d'un chapitre complété.
    Génère la session d'exercices pour cet utilisateur et ce chapitre.
    """
    try:
        asyncio.run(_async_generate(user_id, chapter_id))
    except Exception as exc:
        raise self.retry(exc=exc)


@app.task
def check_and_generate_pending():
    """Vérifie tous les utilisateurs et génère les batches manquants."""
    asyncio.run(_async_check_pending())


async def _async_generate(user_id: int, chapter_id: int):
    from sqlalchemy import select
    from hermes_core.database import AsyncSessionLocal
    from hermes_core.models.user import User
    from hermes_core.models.book import Chapter, Sentence, Token
    from hermes_core.models.exercise import DailyBatch, Exercise
    from hermes_core.services.exercise_generator import ExerciseGenerator
    from hermes_llm.client import OllamaClient
    from hermes_core.config import get_settings

    settings = get_settings()

    async with AsyncSessionLocal() as db:
        user = await db.get(User, user_id)
        chapter = await db.get(Chapter, chapter_id)
        if not user or not chapter:
            return

        result = await db.execute(
            select(Sentence)
            .where(Sentence.chapter_id == chapter_id)
            .order_by(Sentence.order_index)
        )
        sentences = result.scalars().all()
        chapter_text = " ".join(s.text for s in sentences)
        chapter_excerpt = chapter_text[:6000]

        result = await db.execute(
            select(Token)
            .join(Sentence)
            .where(Sentence.chapter_id == chapter_id)
            .where(Token.pos.in_(["NOUN", "VERB", "ADJ"]))
        )
        tokens = result.scalars().all()
        candidate_words = list({t.lemma for t in tokens if len(t.lemma) > 3})
        mastery = user.vocabulary_mastery or {}

        # Mots SRS dus en priorité (SM-2), complétés par les nouveaux mots du chapitre
        from hermes_core.services.srs_engine import get_due_words
        srs_due = await get_due_words(user_id, db, limit=10)
        srs_set = set(srs_due)
        new_words = sorted(
            [w for w in candidate_words if w not in srs_set],
            key=lambda w: mastery.get(w, 0.0),
        )
        target_words = (srs_due + new_words)[:20]

        ollama = OllamaClient(settings.ollama_host, settings.ollama_model)
        generator = ExerciseGenerator(ollama)
        exercises_data = await generator.generate_daily_batch(
            user=user,
            chapter_text=chapter_text,
            chapter_excerpt=chapter_excerpt,
            target_words=target_words,
        )

        batch = DailyBatch(user_id=user_id, chapter_id=chapter_id)
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
                    source_chapter_id=chapter_id,
                    batch_id=batch.id,
                )
                db.add(exercise)

        await db.commit()


async def _async_check_pending():
    import datetime
    from sqlalchemy import select
    from hermes_core.database import AsyncSessionLocal
    from hermes_core.models.user import User
    from hermes_core.models.exercise import DailyBatch
    from hermes_core.models.progress import ReadingProgress

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User))
        users = result.scalars().all()
        today = datetime.date.today()

        for user in users:
            # Vérifier si un batch a été généré aujourd'hui
            batch_result = await db.execute(
                select(DailyBatch)
                .where(DailyBatch.user_id == user.id)
                .where(DailyBatch.generated_at >= datetime.datetime.combine(today, datetime.time.min))
            )
            if batch_result.scalar_one_or_none():
                continue

            # Récupérer le dernier chapitre lu
            prog_result = await db.execute(
                select(ReadingProgress)
                .where(ReadingProgress.user_id == user.id)
                .order_by(ReadingProgress.completed_at.desc())
            )
            latest = prog_result.scalar_one_or_none()
            if latest:
                generate_batch_for_user.delay(user.id, latest.chapter_id)
