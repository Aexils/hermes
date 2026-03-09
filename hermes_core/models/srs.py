import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from hermes_core.database import Base


class VocabSRS(Base):
    __tablename__ = "vocab_srs"
    __table_args__ = (UniqueConstraint("user_id", "word", name="uq_user_word"),)

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    word = Column(String, nullable=False)

    # SM-2 fields
    interval = Column(Integer, default=1)        # jours avant prochaine révision
    repetitions = Column(Integer, default=0)     # nb de succès consécutifs
    easiness = Column(Float, default=2.5)        # facteur de facilité (EF)
    next_review = Column(DateTime, default=datetime.datetime.utcnow)
    last_reviewed = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="vocab_srs")
