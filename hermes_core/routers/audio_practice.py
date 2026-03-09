"""
Endpoints pour la pratique audio :
- Dictée : écouter → taper → comparer
- Prononciation : lire à voix haute → enregistrer → feedback Whisper
"""
import random
import tempfile
import os
from difflib import SequenceMatcher
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel
from hermes_core.database import get_db
from hermes_core.models.book import Book, Sentence
from hermes_core.models.user import User

router = APIRouter(prefix="/audio-practice", tags=["audio-practice"])

# Cache module-level — le modèle Whisper se charge une seule fois par container
_whisper_model = None

def _get_whisper() -> "WhisperModel":
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel
        # "base" pour la prononciation en temps réel (rapide) — le worker utilise
        # le modèle configuré (medium/large) pour la transcription batch
        try:
            _whisper_model = WhisperModel("base", device="cuda", compute_type="float16")
        except Exception:
            _whisper_model = WhisperModel("base", device="cpu", compute_type="int8")
    return _whisper_model


# ── Schémas ───────────────────────────────────────────────────────────────────

class DictationChallenge(BaseModel):
    sentence_id: int
    audio_start: float
    audio_end: float
    file_index: int
    word_count: int
    book_id: int
    word_timestamps: list[dict] | None = None


class DictationCheckPayload(BaseModel):
    sentence_id: int
    user_text: str


class WordResult(BaseModel):
    word: str
    correct: bool
    user_word: str | None = None


class DictationResult(BaseModel):
    correct_text: str
    user_text: str
    similarity: float
    word_results: list[WordResult]
    passed: bool   # similarity >= 0.80


class PronunciationResult(BaseModel):
    expected_text: str
    user_text: str
    similarity: float
    word_results: list[WordResult]
    feedback: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a.strip().lower(), b.strip().lower()).ratio()


def _word_diff(correct: str, user: str) -> list[WordResult]:
    """Compare mot par mot, aligne par position."""
    c_words = correct.strip().lower().split()
    u_words = user.strip().lower().split()
    results = []
    for i, cw in enumerate(c_words):
        uw = u_words[i] if i < len(u_words) else None
        # Nettoyer la ponctuation pour la comparaison
        cw_clean = cw.strip(".,!?;:\"'")
        uw_clean = uw.strip(".,!?;:\"'") if uw else None
        results.append(WordResult(
            word=cw,
            correct=(cw_clean == uw_clean),
            user_word=uw,
        ))
    return results


def _cefr_to_word_range(cefr: str) -> tuple[int, int]:
    """Filtre les phrases par longueur selon le niveau CEFR."""
    ranges = {
        "A1": (4, 8), "A1+": (4, 8),
        "A2-": (5, 10), "A2": (6, 12), "A2+": (6, 14),
        "B1-": (8, 16), "B1": (8, 18), "B1+": (10, 20),
        "B2-": (12, 22), "B2": (14, 24), "B2+": (16, 28),
        "C1-": (18, 35), "C1": (20, 40), "C1+": (22, 45),
        "C2": (25, 50),
    }
    return ranges.get(cefr, (8, 20))


# ── Endpoints dictée ──────────────────────────────────────────────────────────

@router.get("/{book_id}/dictation", response_model=DictationChallenge)
async def get_dictation_challenge(
    book_id: int,
    user_id: int = 1,
    db: AsyncSession = Depends(get_db),
):
    """
    Retourne une phrase transcrite aléatoire du livre pour la dictée.
    La longueur est filtrée selon le niveau CEFR de l'utilisateur.
    Le texte de la phrase n'est PAS retourné — le frontend ne doit pas l'afficher.
    """
    book = await db.get(Book, book_id)
    if not book:
        raise HTTPException(404, "Book not found")
    if not book.transcribed:
        raise HTTPException(400, "Book not transcribed yet")

    user = await db.get(User, user_id)
    cefr = user.cefr_level if user else "B1"
    min_words, max_words = _cefr_to_word_range(cefr)

    # Récupérer les phrases transcrites avec timestamps dans la plage de mots
    result = await db.execute(
        select(Sentence)
        .join(Sentence.chapter)
        .where(Sentence.chapter.has(book_id=book_id))
        .where(Sentence.audio_start.isnot(None))
        .where(func.array_length(
            func.string_to_array(func.trim(Sentence.text), ' '), 1
        ).between(min_words, max_words))
        .order_by(func.random())
        .limit(1)
    )
    sentence = result.scalar_one_or_none()

    if not sentence:
        # Fallback : toute phrase transcrite
        result2 = await db.execute(
            select(Sentence)
            .join(Sentence.chapter)
            .where(Sentence.chapter.has(book_id=book_id))
            .where(Sentence.audio_start.isnot(None))
            .order_by(func.random())
            .limit(1)
        )
        sentence = result2.scalar_one_or_none()

    if not sentence:
        raise HTTPException(404, "No transcribed sentences found for this book")

    word_count = len(sentence.text.split())
    return DictationChallenge(
        sentence_id=sentence.id,
        audio_start=sentence.audio_start,
        audio_end=sentence.audio_end or sentence.audio_start + 5.0,
        file_index=sentence.audio_file_index or 0,
        word_count=word_count,
        book_id=book_id,
        word_timestamps=sentence.word_timestamps,
    )


@router.post("/{book_id}/dictation/check", response_model=DictationResult)
async def check_dictation(
    book_id: int,
    payload: DictationCheckPayload,
    db: AsyncSession = Depends(get_db),
):
    """Compare le texte tapé par l'utilisateur à la phrase originale."""
    sentence = await db.get(Sentence, payload.sentence_id)
    if not sentence:
        raise HTTPException(404, "Sentence not found")

    correct_text = sentence.text.strip()
    user_text = payload.user_text.strip()
    similarity = _similarity(correct_text, user_text)
    word_results = _word_diff(correct_text, user_text)

    return DictationResult(
        correct_text=correct_text,
        user_text=user_text,
        similarity=round(similarity, 3),
        word_results=word_results,
        passed=similarity >= 0.80,
    )


# ── Endpoints prononciation ───────────────────────────────────────────────────

@router.get("/{book_id}/pronunciation/sentence", response_model=dict)
async def get_pronunciation_sentence(
    book_id: int,
    user_id: int = 1,
    db: AsyncSession = Depends(get_db),
):
    """
    Retourne une phrase à lire à voix haute.
    Ici on affiche le texte — c'est de la production guidée.
    """
    book = await db.get(Book, book_id)
    if not book:
        raise HTTPException(404, "Book not found")

    user = await db.get(User, user_id)
    cefr = user.cefr_level if user else "B1"
    min_words, max_words = _cefr_to_word_range(cefr)

    result = await db.execute(
        select(Sentence)
        .join(Sentence.chapter)
        .where(Sentence.chapter.has(book_id=book_id))
        .where(Sentence.audio_start.isnot(None))
        .where(func.array_length(
            func.string_to_array(func.trim(Sentence.text), ' '), 1
        ).between(min_words, max_words))
        .order_by(func.random())
        .limit(1)
    )
    sentence = result.scalar_one_or_none()
    if not sentence:
        raise HTTPException(404, "No suitable sentences found")

    return {
        "sentence_id": sentence.id,
        "text": sentence.text,
        "audio_start": sentence.audio_start,
        "audio_end": sentence.audio_end,
        "file_index": sentence.audio_file_index or 0,
        "word_timestamps": sentence.word_timestamps,
    }


@router.post("/{book_id}/pronunciation/check", response_model=PronunciationResult)
async def check_pronunciation(
    book_id: int,
    expected_text: str = Form(...),
    audio: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """
    Reçoit un enregistrement audio, le transcrit avec Whisper,
    et compare à la phrase attendue.
    """
    from hermes_core.config import get_settings
    settings = get_settings()

    # Sauvegarder l'audio temporairement
    suffix = os.path.splitext(audio.filename or "rec.webm")[1] or ".webm"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await audio.read())
        tmp_path = tmp.name

    try:
        model = _get_whisper()
        segments_iter, _ = model.transcribe(
            tmp_path,
            language="en",
            word_timestamps=True,
            vad_filter=True,
        )
        segments = list(segments_iter)
        user_text = " ".join(seg.text.strip() for seg in segments).strip()
    except Exception as exc:
        raise HTTPException(500, f"Transcription failed: {exc}")
    finally:
        os.unlink(tmp_path)

    similarity = _similarity(expected_text, user_text)
    word_results = _word_diff(expected_text, user_text)

    wrong_words = [r.word for r in word_results if not r.correct]
    if similarity >= 0.90:
        feedback = "Excellent pronunciation! Native-like clarity."
    elif similarity >= 0.75:
        feedback = f"Good effort! Work on: {', '.join(wrong_words[:3])}." if wrong_words else "Very good!"
    elif similarity >= 0.55:
        feedback = f"Keep practicing. Focus on: {', '.join(wrong_words[:4])}."
    else:
        feedback = "Try again more slowly. Listen to the reference audio first."

    return PronunciationResult(
        expected_text=expected_text,
        user_text=user_text,
        similarity=round(similarity, 3),
        word_results=word_results,
        feedback=feedback,
    )
