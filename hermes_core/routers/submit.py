import datetime
import re as _re
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from hermes_core.database import get_db
from hermes_core.models.user import User
from hermes_core.models.exercise import Exercise, ExerciseAttempt
from hermes_core.schemas.exercise import AnswerIn, AnswerResult
from hermes_core.services.adaptation_engine import AdaptationEngine
from hermes_core.services.answer_evaluator import evaluate_open_ended
from hermes_core.services.srs_engine import update_srs
from hermes_core.services.spell_checker import check_spelling

router = APIRouter(prefix="/submit", tags=["submit"])
adapter = AdaptationEngine()


@router.post("/{user_id}/{exercise_id}", response_model=AnswerResult)
async def submit_answer(
    user_id: int,
    exercise_id: int,
    payload: AnswerIn,
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")

    exercise = await db.get(Exercise, exercise_id)
    if not exercise:
        raise HTTPException(404, "Exercise not found")

    # Bloquer la re-soumission d'un exercice déjà tenté (anti-farming)
    existing_stmt = await db.execute(
        select(ExerciseAttempt).where(
            ExerciseAttempt.user_id == user_id,
            ExerciseAttempt.exercise_id == exercise_id,
        ).limit(1)
    )
    existing_attempt = existing_stmt.scalar_one_or_none()
    if existing_attempt:
        return AnswerResult(
            correct=existing_attempt.is_correct,
            correct_answer=exercise.correct_answer,
            explanation=None,
            new_grammar_score=None,
            new_vocab_score=None,
            cefr_changed=None,
            spelling_errors=[],
            session_summary=None,
            session_focus_area=None,
            learner_profile=None,
        )

    # Détection orthographe (uniquement pour les réponses textuelles)
    spelling_errors: list[dict] = []
    if exercise.subtype in ("open_ended", "fill_blank", "sentence_transformation", "error_correction"):
        spelling_errors = check_spelling(payload.answer)

    # Évaluation
    explanation = None
    if exercise.subtype == "open_ended":
        eval_result = await evaluate_open_ended(
            question=exercise.question,
            correct_answer=exercise.correct_answer,
            user_answer=payload.answer,
            cefr_level=user.cefr_level,
        )
        is_correct = eval_result["is_correct"]
        explanation = eval_result.get("feedback")
    else:
        user_ans = payload.answer.strip().lower()
        correct_ans = exercise.correct_answer.strip().lower()

        _prefix = r'^[a-d][.)]\s*'
        user_ans_norm = _re.sub(_prefix, '', user_ans)
        correct_ans_norm = _re.sub(_prefix, '', correct_ans)
        correct_letter = correct_ans[0] if correct_ans and correct_ans[0] in 'abcd' else None

        is_correct = (
            user_ans == correct_ans
            or user_ans_norm == correct_ans_norm
            or (correct_letter and user_ans == correct_letter)
        )

    # Enregistrer la tentative avec le temps de réponse
    attempt = ExerciseAttempt(
        user_id=user_id,
        exercise_id=exercise_id,
        user_answer=payload.answer,
        is_correct=is_correct,
        time_taken_ms=payload.time_taken_ms,
    )
    db.add(attempt)

    # Mettre à jour l'error_log (50 dernières erreurs)
    if not is_correct:
        log = list(user.error_log or [])
        log.append({
            "exercise_id": exercise_id,
            "type": exercise.type,
            "category": exercise.grammar_category or exercise.vocabulary_item,
            "user_answer": payload.answer,
            "correct_answer": exercise.correct_answer,
            "ts": datetime.datetime.utcnow().isoformat(),
        })
        user.error_log = log[-50:]

    new_grammar_score = None
    new_vocab_score = None
    cefr_changed = None

    time_ms = payload.time_taken_ms

    if exercise.type == "grammar" and exercise.grammar_category:
        updated = adapter.update_grammar_score(
            user.grammar_scores or {},
            exercise.grammar_category,
            is_correct,
            time_ms=time_ms,
        )
        user.grammar_scores = updated
        new_grammar_score = updated.get(exercise.grammar_category)

        new_cefr = adapter.update_cefr_if_needed(user)
        if new_cefr:
            user.cefr_level = new_cefr
            cefr_changed = new_cefr

    elif exercise.type == "vocabulary" and exercise.vocabulary_item:
        updated = adapter.update_vocabulary_score(
            user.vocabulary_mastery or {},
            exercise.vocabulary_item,
            is_correct,
            time_ms=time_ms,
        )
        user.vocabulary_mastery = updated
        new_vocab_score = updated.get(exercise.vocabulary_item)
        await update_srs(user_id, exercise.vocabulary_item, is_correct, db)

    await db.commit()

    # ── Post-session : résumé + mise à jour du profil ─────────────────────────
    session_summary = None
    session_focus_area = None
    updated_profile = None

    if payload.is_last and exercise.batch_id:
        session_summary, session_focus_area, updated_profile = await _handle_session_end(
            user=user,
            batch_id=exercise.batch_id,
            db=db,
        )

    return AnswerResult(
        correct=is_correct,
        correct_answer=exercise.correct_answer,
        explanation=explanation,
        new_grammar_score=new_grammar_score,
        new_vocab_score=new_vocab_score,
        cefr_changed=cefr_changed,
        spelling_errors=spelling_errors,
        session_summary=session_summary,
        session_focus_area=session_focus_area,
        learner_profile=updated_profile,
    )


async def _handle_session_end(
    user: User,
    batch_id: int,
    db: AsyncSession,
) -> tuple[str | None, str | None, str | None]:
    """
    Appelé sur le dernier exercice d'une session.
    1. Reconstruit les résultats de la session depuis la DB
    2. Génère un résumé post-session via le LLM
    3. Régénère le profil apprenant si nécessaire
    Retourne (summary, focus_area, updated_profile).
    """
    from hermes_core.config import get_settings
    from hermes_llm.client import OllamaClient
    from hermes_llm.prompts.session_summary import build_session_summary_prompt
    from hermes_core.services.learner_profile import refresh_profile_if_needed

    settings = get_settings()
    client = OllamaClient(settings.ollama_host, settings.ollama_model)

    # Récupérer toutes les tentatives de cette session (exercices du batch)
    result = await db.execute(
        select(ExerciseAttempt, Exercise)
        .join(Exercise, ExerciseAttempt.exercise_id == Exercise.id)
        .where(ExerciseAttempt.user_id == user.id)
        .where(Exercise.batch_id == batch_id)
        .order_by(ExerciseAttempt.attempted_at)
    )
    rows = result.all()

    session_results = [
        {
            "type": ex.type,
            "is_correct": att.is_correct,
            "time_ms": att.time_taken_ms,
            "user_answer": att.user_answer,
            "correct_answer": ex.correct_answer,
            "grammar_category": ex.grammar_category,
            "vocabulary_item": ex.vocabulary_item,
        }
        for att, ex in rows
    ]

    summary = None
    focus_area = None

    if session_results:
        try:
            prompt = build_session_summary_prompt(user, session_results)
            data = await client.generate_json(prompt, temperature=0.5, thinking=False)
            summary = data.get("summary")
            focus_area = data.get("focus_area")
        except Exception:
            pass  # Le résumé est optionnel, ne pas bloquer

    # Régénérer le profil apprenant si nécessaire (après session)
    updated_profile = await refresh_profile_if_needed(
        user=user, client=client, db=db, after_session=True
    )

    return summary, focus_area, updated_profile
