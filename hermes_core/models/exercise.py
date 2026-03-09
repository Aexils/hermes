from sqlalchemy import Column, Integer, String, Text, ForeignKey, JSON, Boolean, DateTime, Float, Date
from sqlalchemy.orm import relationship
from hermes_core.database import Base
import datetime


class Exercise(Base):
    __tablename__ = "exercises"

    id = Column(Integer, primary_key=True)
    type = Column(String)  # "comprehension", "grammar", "vocabulary"
    subtype = Column(String)  # "fill_blank", "mcq", "error_correction", etc.
    question = Column(Text)
    options = Column(JSON, nullable=True)  # Pour les QCM
    correct_answer = Column(Text)
    grammar_category = Column(String, nullable=True)  # "past_simple", etc.
    vocabulary_item = Column(String, nullable=True)
    source_passage = Column(Text, nullable=True)
    source_chapter_id = Column(Integer, ForeignKey("chapters.id"), nullable=True)
    batch_id = Column(Integer, ForeignKey("daily_batches.id"))
    batch = relationship("DailyBatch", back_populates="exercises")
    attempts = relationship("ExerciseAttempt", back_populates="exercise")


class ExerciseAttempt(Base):
    __tablename__ = "exercise_attempts"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    exercise_id = Column(Integer, ForeignKey("exercises.id"))
    user_answer = Column(Text)
    is_correct = Column(Boolean)
    attempted_at = Column(DateTime, default=datetime.datetime.utcnow)
    time_taken_ms = Column(Integer, nullable=True)  # Temps de réponse en millisecondes
    user = relationship("User", back_populates="exercise_attempts")
    exercise = relationship("Exercise", back_populates="attempts")


class DailyBatch(Base):
    __tablename__ = "daily_batches"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    chapter_id = Column(Integer, ForeignKey("chapters.id"))
    generated_at = Column(DateTime, default=datetime.datetime.utcnow)
    completed = Column(Boolean, default=False)
    # Champs nightly pre-generation
    batch_type = Column(String, default="chapter")        # chapter | book | book_progress | grammar_drill
    grammar_focus = Column(String, nullable=True)         # ex: "present_perfect"
    pre_generated = Column(Boolean, default=False)        # True = généré par le cron
    valid_for_date = Column(Date, nullable=True)          # date pour laquelle ce batch est prévu
    model_used = Column(String, nullable=True)            # ex: "qwen3.5:9b"
    user = relationship("User", back_populates="daily_batches")
    exercises = relationship("Exercise", back_populates="batch")
