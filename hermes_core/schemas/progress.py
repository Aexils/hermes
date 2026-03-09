from pydantic import BaseModel
from typing import Optional
import datetime


class ProgressOut(BaseModel):
    book_title: str
    author: Optional[str]
    chapters_completed: int
    chapters_total: int
    percent_complete: float
    last_read: Optional[datetime.datetime]


class SyncResult(BaseModel):
    synced_from: str  # "booklore"
    new_chapters_detected: int
    batches_queued: int
    parsing_books: list[str] = []  # titres des livres dont le parsing vient d'être déclenché
