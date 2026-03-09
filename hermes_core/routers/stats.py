from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, cast, Date as SADate
from hermes_core.database import get_db
from hermes_core.models.user import User
from hermes_core.models.exercise import ExerciseAttempt
from hermes_core.schemas.user import UserOut, WeaknessReport
from hermes_core.services.adaptation_engine import AdaptationEngine
import datetime

router = APIRouter(prefix="/stats", tags=["stats"])
adapter = AdaptationEngine()


@router.get("/{user_id}", response_model=UserOut)
async def get_stats(user_id: int, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    return UserOut.model_validate(user)


@router.get("/{user_id}/weaknesses", response_model=WeaknessReport)
async def get_weaknesses(user_id: int, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")

    scores = user.grammar_scores or {}
    weakest_cats = adapter.get_weakest_grammar_categories(scores, n=5)
    weakest_grammar = [{"category": c, "score": scores.get(c, 0.0)} for c in weakest_cats]

    mastery = user.vocabulary_mastery or {}
    weakest_vocab_words = sorted(mastery.items(), key=lambda x: x[1])[:10]
    weakest_vocab = [{"word": w, "score": s} for w, s in weakest_vocab_words]

    return WeaknessReport(
        weakest_grammar=weakest_grammar,
        weakest_vocabulary=weakest_vocab,
        recommended_focus=[c for c in weakest_cats[:3]],
    )


@router.get("/{user_id}/activity")
async def get_activity(user_id: int, days: int = 35, db: AsyncSession = Depends(get_db)):
    start = datetime.datetime.utcnow() - datetime.timedelta(days=days)
    rows = (await db.execute(
        select(
            cast(ExerciseAttempt.attempted_at, SADate).label("day"),
            func.count(ExerciseAttempt.id).label("count"),
        )
        .where(ExerciseAttempt.user_id == user_id, ExerciseAttempt.attempted_at >= start)
        .group_by(cast(ExerciseAttempt.attempted_at, SADate))
        .order_by(cast(ExerciseAttempt.attempted_at, SADate))
    )).all()
    return [{"date": str(row.day), "count": row.count} for row in rows]
