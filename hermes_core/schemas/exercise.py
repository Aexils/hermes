from pydantic import BaseModel
from typing import Optional, Any


class ExerciseOut(BaseModel):
    id: int
    type: str
    subtype: str
    question: str
    options: Optional[list[str]] = None
    grammar_category: Optional[str] = None
    vocabulary_item: Optional[str] = None
    source_passage: Optional[str] = None

    model_config = {"from_attributes": True}


class AnswerIn(BaseModel):
    answer: str
    time_taken_ms: Optional[int] = None   # Temps écoulé depuis l'affichage de la question
    is_last: bool = False                  # True sur le dernier exercice de la session


class SpellingError(BaseModel):
    word: str
    suggestion: str


class AnswerResult(BaseModel):
    correct: bool
    correct_answer: str
    explanation: Optional[str] = None
    new_grammar_score: Optional[float] = None
    new_vocab_score: Optional[float] = None
    cefr_changed: Optional[str] = None
    spelling_errors: list[SpellingError] = []
    # Retournés uniquement sur le dernier exercice de la session
    session_summary: Optional[str] = None
    session_focus_area: Optional[str] = None
    learner_profile: Optional[str] = None


class NightlySessionOut(BaseModel):
    batch_id: int
    batch_type: str                          # "book_progress" | "grammar_drill"
    grammar_focus: Optional[str] = None
    title: str
    description: str
    exercise_count: int
    priority: Optional[str] = None          # "weak" | "review" | None


class NightlyPlanOut(BaseModel):
    valid_for_date: str
    sessions: list[NightlySessionOut]


class DailyBatchOut(BaseModel):
    batch_id: int
    chapter_title: str
    book_title: str
    comprehension: list[ExerciseOut]
    grammar: list[ExerciseOut]
    vocabulary: list[ExerciseOut]
    total_exercises: int
    scope: str = "chapter"
    anecdotes: list[dict[str, Any]] = []
