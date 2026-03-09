from sqlalchemy import Column, Integer, ForeignKey, DateTime, String
from sqlalchemy.orm import relationship
from hermes_core.database import Base
import datetime


class ReadingProgress(Base):
    __tablename__ = "reading_progress"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    chapter_id = Column(Integer, ForeignKey("chapters.id"))
    source = Column(String)  # "booklore", "manual"
    completed_at = Column(DateTime, default=datetime.datetime.utcnow)
    user = relationship("User", back_populates="reading_progress")
