"""
Algorithme SM-2 (Spaced Repetition System) — version utilisée par Anki.

quality : 0–5
  0-2 → réponse incorrecte  (reset)
  3-5 → réponse correcte   (avance)

Formule :
  EF' = EF + 0.1 − (5 − q) × (0.08 + (5 − q) × 0.02)
  EF  ≥ 1.3 (minimum)
  interval:
    rep 0 → 1 jour
    rep 1 → 6 jours
    rep N → round(interval × EF)
"""
import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from hermes_core.models.srs import VocabSRS


def sm2_next(interval: int, repetitions: int, easiness: float, quality: int) -> tuple[int, int, float]:
    """Retourne (new_interval, new_repetitions, new_easiness)."""
    new_ef = easiness + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)
    new_ef = max(1.3, round(new_ef, 4))

    if quality < 3:
        return 1, 0, new_ef
    else:
        new_reps = repetitions + 1
        if repetitions == 0:
            new_interval = 1
        elif repetitions == 1:
            new_interval = 6
        else:
            new_interval = max(1, round(interval * new_ef))
        return new_interval, new_reps, new_ef


async def update_srs(user_id: int, word: str, is_correct: bool, db: AsyncSession) -> VocabSRS:
    """Met à jour (ou crée) l'entrée SRS pour un mot donné."""
    result = await db.execute(
        select(VocabSRS)
        .where(VocabSRS.user_id == user_id)
        .where(VocabSRS.word == word)
    )
    card = result.scalar_one_or_none()

    if not card:
        card = VocabSRS(user_id=user_id, word=word)
        db.add(card)

    quality = 4 if is_correct else 1
    new_interval, new_reps, new_ef = sm2_next(
        card.interval, card.repetitions, card.easiness, quality
    )

    card.interval = new_interval
    card.repetitions = new_reps
    card.easiness = new_ef
    card.last_reviewed = datetime.datetime.utcnow()
    card.next_review = datetime.datetime.utcnow() + datetime.timedelta(days=new_interval)

    return card


async def get_due_words(user_id: int, db: AsyncSession, limit: int = 15) -> list[str]:
    """Retourne les mots dont la révision est due (next_review <= now)."""
    now = datetime.datetime.utcnow()
    result = await db.execute(
        select(VocabSRS.word)
        .where(VocabSRS.user_id == user_id)
        .where(VocabSRS.next_review <= now)
        .order_by(VocabSRS.next_review)
        .limit(limit)
    )
    return [row[0] for row in result.all()]
