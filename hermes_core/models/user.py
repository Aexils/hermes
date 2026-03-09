from sqlalchemy import Column, Integer, String, Text, JSON, DateTime
from sqlalchemy.orm import relationship
from hermes_core.database import Base
import datetime


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    username = Column(String, unique=True, nullable=False)
    cefr_level = Column(String, default="B1")  # A1 à C2
    grammar_scores = Column(JSON, default=dict)
    vocabulary_mastery = Column(JSON, default=dict)
    error_log = Column(JSON, default=list)
    cefr_streak = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    # Profil apprenant généré par le LLM — injecté dans chaque prompt de session
    learner_profile = Column(Text, nullable=True)
    learner_profile_updated_at = Column(DateTime, nullable=True)

    reading_progress = relationship("ReadingProgress", back_populates="user")
    exercise_attempts = relationship("ExerciseAttempt", back_populates="user")
    daily_batches = relationship("DailyBatch", back_populates="user")
    vocab_srs = relationship("VocabSRS", back_populates="user")
