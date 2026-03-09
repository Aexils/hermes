from sqlalchemy import Column, Integer, String, Text, ForeignKey, Boolean, JSON, Float
from sqlalchemy.orm import relationship
from hermes_core.database import Base


class Book(Base):
    __tablename__ = "books"

    id = Column(Integer, primary_key=True)
    title = Column(String, nullable=False)
    author = Column(String)
    file_path = Column(String, unique=True, nullable=False)
    format = Column(String)  # "epub" ou "kepub"
    parsed = Column(Boolean, default=False)
    anecdotes = Column(JSON, nullable=True)

    # Audiobookshelf
    audio_item_id = Column(String, nullable=True)       # ABS item ID
    audio_path = Column(Text, nullable=True)             # Chemin local du fichier audio principal
    transcribed = Column(Boolean, default=False)
    transcription_status = Column(String, default="none")  # none | pending | running | done | failed

    chapters = relationship("Chapter", back_populates="book")


class Chapter(Base):
    __tablename__ = "chapters"

    id = Column(Integer, primary_key=True)
    book_id = Column(Integer, ForeignKey("books.id"))
    title = Column(String)
    order_index = Column(Integer)
    summary = Column(Text, nullable=True)
    book = relationship("Book", back_populates="chapters")
    sentences = relationship("Sentence", back_populates="chapter")


class Sentence(Base):
    __tablename__ = "sentences"

    id = Column(Integer, primary_key=True)
    chapter_id = Column(Integer, ForeignKey("chapters.id"))
    text = Column(Text, nullable=False)
    order_index = Column(Integer)
    # Timestamps audio (en secondes dans le fichier audio du chapitre)
    audio_start = Column(Float, nullable=True)
    audio_end = Column(Float, nullable=True)
    audio_file_index = Column(Integer, nullable=True)
    # Timestamps mot par mot : [{"word": "cat", "start": 42.5, "end": 42.8}, ...]
    word_timestamps = Column(JSON, nullable=True)

    chapter = relationship("Chapter", back_populates="sentences")
    tokens = relationship("Token", back_populates="sentence")


class Token(Base):
    __tablename__ = "tokens"

    id = Column(Integer, primary_key=True)
    sentence_id = Column(Integer, ForeignKey("sentences.id"))
    word = Column(String)
    lemma = Column(String)
    pos = Column(String)  # Part of speech (NOUN, VERB, etc.)
    sentence = relationship("Sentence", back_populates="tokens")
