# Hermes — Plan d'implémentation complet pour Claude Code

## Vue d'ensemble

Hermes est un moteur d'apprentissage de l'anglais adaptatif, auto-hébergé. Il se synchronise avec Booklore pour détecter les chapitres en cours de lecture, parse les EPUBs locaux, génère des exercices (compréhension, grammaire, vocabulaire) via un LLM local Ollama, et s'adapte aux erreurs de l'utilisateur. Système **mono-utilisateur**.

**Stack :** Python 3.11 · FastAPI · PostgreSQL · Redis · Ollama · Docker Compose  
**Contraintes :** CPU-only · 16–32 GB RAM · réseau local uniquement · Windows host

## Environnement de déploiement

```
Machine Windows (host)
├── Docker Desktop
│   ├── booklore          (existant, port 6060)
│   ├── hermes-core       (nouveau, port 8000)
│   ├── hermes-worker     (nouveau)
│   ├── postgres          (nouveau)
│   ├── redis             (nouveau)
│   └── ollama            (nouveau, port 11434)
└── C:\Users\alexi\Desktop\booklore\bookdrop\
    └── {Auteur}\{Titre}.epub   ← monté en volume dans hermes ET booklore
```

**Source de vérité pour la progression :** `GET http://booklore:6060/api/v1/books`
- Retourne tous les livres, flag "en cours", pourcentage de lecture, path absolu vers l'EPUB
- Mapping path : Booklore expose `/bookdrop/...` dans son API → Hermes remplace par `/books/...` (simple substitution de préfixe)
- Pas de `KoboReader.sqlite`, pas d'Audiobookshelf pour le MVP

**Authentification Booklore :** refresh token stocké dans `.env`, renouvelé automatiquement via `POST /api/v1/auth/refresh`

---

## Structure du dépôt

```
hermes/
├── docker-compose.yml
├── .env.example
├── alembic/
│   ├── env.py
│   └── versions/
├── hermes_core/          # Service FastAPI principal
│   ├── main.py
│   ├── config.py
│   ├── database.py
│   ├── models/
│   │   ├── __init__.py
│   │   ├── user.py
│   │   ├── book.py
│   │   ├── exercise.py
│   │   └── progress.py
│   ├── schemas/
│   │   ├── __init__.py
│   │   ├── user.py
│   │   ├── exercise.py
│   │   └── progress.py
│   ├── routers/
│   │   ├── daily.py
│   │   ├── submit.py
│   │   ├── stats.py
│   │   └── progress.py
│   ├── services/
│   │   ├── epub_parser.py
│   │   ├── booklore_client.py    # Source principale de progression
│   │   ├── exercise_generator.py
│   │   ├── adaptation_engine.py
│   │   └── batch_scheduler.py
│   └── Dockerfile
├── hermes_worker/        # Processeur de tâches asynchrones
│   ├── worker.py
│   ├── tasks/
│   │   ├── parse_book.py
│   │   ├── generate_batch.py
│   │   └── sync_progress.py
│   └── Dockerfile
├── hermes_llm/           # Couche d'intégration Ollama
│   ├── client.py
│   ├── prompts/
│   │   ├── comprehension.py
│   │   ├── grammar.py
│   │   └── vocabulary.py
│   └── Dockerfile
└── scripts/
    ├── init_db.py
    └── seed_user.py
```

---

## 1. Docker Compose

```yaml
# docker-compose.yml
version: "3.9"

services:
  hermes-core:
    build: ./hermes_core
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
      - OLLAMA_HOST=${OLLAMA_HOST}
      - BOOKLORE_API=${BOOKLORE_API}
      - BOOKLORE_REFRESH_TOKEN=${BOOKLORE_REFRESH_TOKEN}
      - BOOKS_PATH=${BOOKS_PATH}
    volumes:
      # Même dossier que Booklore, mais monté sur /books dans Hermes
      # Booklore l'appelle /bookdrop, Hermes l'appelle /books — BookloreClient gère la conversion
      - C:\Users\alexi\Desktop\booklore\bookdrop:/books:ro
    depends_on:
      - postgres
      - redis
      - ollama

  hermes-worker:
    build: ./hermes_worker
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
      - OLLAMA_HOST=${OLLAMA_HOST}
      - BOOKLORE_API=${BOOKLORE_API}
      - BOOKLORE_REFRESH_TOKEN=${BOOKLORE_REFRESH_TOKEN}
      - BOOKS_PATH=${BOOKS_PATH}
    volumes:
      - C:\Users\alexi\Desktop\booklore\bookdrop:/books:ro
    depends_on:
      - postgres
      - redis
      - ollama

  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: hermes
      POSTGRES_USER: hermes
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  ollama:
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama
    # CPU-only : pas de deploy GPU

volumes:
  postgres_data:
  ollama_data:
```

```env
# .env.example
DATABASE_URL=postgresql+asyncpg://hermes:password@postgres:5432/hermes
REDIS_URL=redis://redis:6379/0
OLLAMA_HOST=http://ollama:11434
OLLAMA_MODEL=mistral:7b
POSTGRES_PASSWORD=changeme

# Booklore — source principale de progression et d'EPUBs
BOOKLORE_API=http://booklore:6060
BOOKLORE_REFRESH_TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
# Path du dossier bookdrop monté dans le container Hermes
BOOKS_PATH=/books
# Équivalent Windows : C:\Users\alexi\Desktop\booklore\bookdrop
# Dans docker-compose : volumes: - C:\Users\alexi\Desktop\booklore\bookdrop:/books:ro
```

---

## 2. Schéma de base de données (SQLAlchemy + Alembic)

### `hermes_core/models/user.py`

```python
from sqlalchemy import Column, Integer, String, Float, JSON, DateTime
from sqlalchemy.orm import relationship
from hermes_core.database import Base
import datetime

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    username = Column(String, unique=True, nullable=False)
    cefr_level = Column(String, default="B1")  # A1 à C2
    grammar_scores = Column(JSON, default=dict)
    # Exemple: {"past_simple": 0.62, "present_perfect": 0.34}
    vocabulary_mastery = Column(JSON, default=dict)
    # Exemple: {"ephemeral": 0.8, "benevolent": 0.3}
    error_log = Column(JSON, default=list)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    reading_progress = relationship("ReadingProgress", back_populates="user")
    exercise_attempts = relationship("ExerciseAttempt", back_populates="user")
    daily_batches = relationship("DailyBatch", back_populates="user")
```

### `hermes_core/models/book.py`

```python
from sqlalchemy import Column, Integer, String, Text, ForeignKey, Boolean
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
    chapters = relationship("Chapter", back_populates="book")

class Chapter(Base):
    __tablename__ = "chapters"
    id = Column(Integer, primary_key=True)
    book_id = Column(Integer, ForeignKey("books.id"))
    title = Column(String)
    order_index = Column(Integer)
    book = relationship("Book", back_populates="chapters")
    sentences = relationship("Sentence", back_populates="chapter")

class Sentence(Base):
    __tablename__ = "sentences"
    id = Column(Integer, primary_key=True)
    chapter_id = Column(Integer, ForeignKey("chapters.id"))
    text = Column(Text, nullable=False)
    order_index = Column(Integer)
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
```

### `hermes_core/models/exercise.py`

```python
from sqlalchemy import Column, Integer, String, Text, ForeignKey, JSON, Boolean, DateTime, Float
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
    user = relationship("User", back_populates="exercise_attempts")
    exercise = relationship("Exercise", back_populates="attempts")

class DailyBatch(Base):
    __tablename__ = "daily_batches"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    chapter_id = Column(Integer, ForeignKey("chapters.id"))
    generated_at = Column(DateTime, default=datetime.datetime.utcnow)
    completed = Column(Boolean, default=False)
    user = relationship("User", back_populates="daily_batches")
    exercises = relationship("Exercise", back_populates="batch")
```

### `hermes_core/models/progress.py`

```python
from sqlalchemy import Column, Integer, ForeignKey, DateTime, String
from sqlalchemy.orm import relationship
from hermes_core.database import Base
import datetime

class ReadingProgress(Base):
    __tablename__ = "reading_progress"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    chapter_id = Column(Integer, ForeignKey("chapters.id"))
    source = Column(String)  # "kobo", "booklore", "audiobookshelf", "manual"
    completed_at = Column(DateTime, default=datetime.datetime.utcnow)
    user = relationship("User", back_populates="reading_progress")
```

---

## 3. Services

### `hermes_core/services/epub_parser.py`

```python
"""
Parse un fichier EPUB ou KEPUB.
Dépendances : ebooklib, beautifulsoup4, spacy (modèle en_core_web_sm)
"""
import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup
import spacy
from pathlib import Path

nlp = spacy.load("en_core_web_sm")

class EPUBParser:
    def __init__(self, file_path: str):
        self.path = Path(file_path)
        # KEPUB : renommer temporairement en .epub pour ebooklib
        self.book = epub.read_epub(str(self.path))

    def get_chapters(self) -> list[dict]:
        """Retourne une liste de chapitres avec leur texte brut."""
        chapters = []
        for i, item in enumerate(self.book.get_items_of_type(ebooklib.ITEM_DOCUMENT)):
            soup = BeautifulSoup(item.get_content(), "html.parser")
            text = soup.get_text(separator="\n", strip=True)
            if len(text) > 100:  # Ignorer les pages de titre vides
                chapters.append({
                    "order_index": i,
                    "title": soup.find("h1") or soup.find("h2") or f"Chapter {i}",
                    "raw_text": text,
                })
        return chapters

    def parse_sentences(self, text: str) -> list[dict]:
        """Tokenise le texte en phrases et tokens via spaCy."""
        doc = nlp(text)
        sentences = []
        for i, sent in enumerate(doc.sents):
            tokens = [
                {"word": t.text, "lemma": t.lemma_, "pos": t.pos_}
                for t in sent if not t.is_space
            ]
            sentences.append({
                "order_index": i,
                "text": sent.text.strip(),
                "tokens": tokens,
            })
        return sentences
```

### `hermes_core/services/booklore_client.py`

```python
"""
Client Booklore — source principale de progression et d'accès aux EPUBs.

Authentification : JWT access token (courte durée) + refresh token (longue durée).
Le client gère automatiquement le renouvellement du token.

Endpoint : GET /api/v1/books — retourne la liste complète des livres avec :
  - readStatus             : "READING" | "UNSET" | absent
  - epubProgress.percentage: float — progression EPUB (ex: 41.2)
  - koboProgress.percentage: float — progression Kobo (ex: 42.0)
  - primaryFile.filePath   : "/bookdrop/{chemin}/{fichier}.epub"
  - primaryFile.bookType   : "EPUB" | "CBX" (ignorer CBX)
  - metadata.title, metadata.authors
  - id                     : int

Mapping path : Booklore monte le bookdrop sur /bookdrop dans son container.
Hermes monte le même dossier sur /books → simple remplacement de préfixe.

Exemple de paths réels observés :
  /bookdrop/Hushabye_epub_04-08-21v1/Hushabye_epub_04-08-21v1 (2021).epub
  /bookdrop/CHAPTER ONE/Harry Potter and.../Harry Potter and....epub
  /bookdrop/Beaton, M.C/Agatha Raisin.../Agatha Raisin....epub
"""
import httpx
import asyncio
from hermes_core.config import get_settings

class BookloreClient:
    def __init__(self):
        self.settings = get_settings()
        self._access_token: str | None = None
        self._lock = asyncio.Lock()

    def _resolve_epub_path(self, file_path_from_api: str) -> str:
        """
        Convertit le path Booklore en path container Hermes.

        Booklore retourne des paths comme :
          /bookdrop/CHAPTER ONE/Harry Potter.../Harry Potter.epub
          /bookdrop/Hushabye_epub_04-08-21v1/Hushabye_epub_04-08-21v1 (2021).epub
          /bookdrop/Beaton, M.C/Agatha Raisin.../Agatha Raisin.epub

        Ces paths sont internes au container Booklore où le volume est monté sur /bookdrop.
        Dans Hermes, le même dossier est monté sur /books.

        Résultat :
          /bookdrop/CHAPTER ONE/Harry Potter.../file.epub
          → /books/CHAPTER ONE/Harry Potter.../file.epub
        """
        BOOKLORE_PREFIX = "/bookdrop/"
        HERMES_PREFIX = self.settings.books_path.rstrip("/") + "/"

        if file_path_from_api.startswith(BOOKLORE_PREFIX):
            return HERMES_PREFIX + file_path_from_api[len(BOOKLORE_PREFIX):]
        # Fallback si le préfixe change
        return file_path_from_api.replace("/bookdrop", self.settings.books_path)

    async def _get_access_token(self) -> str:
        """Renouvelle le token d'accès via le refresh token."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                f"{self.settings.booklore_api}/api/v1/auth/refresh",
                headers={"Cookie": f"refresh_token={self.settings.booklore_refresh_token}"},
            )
            response.raise_for_status()
            data = response.json()
            # Booklore retourne { "token": "..." } ou { "accessToken": "..." }
            # À ajuster selon la réponse réelle de l'API
            return data.get("token") or data.get("accessToken")

    async def _headers(self) -> dict:
        """Retourne les headers avec token valide, renouvelle si nécessaire."""
        async with self._lock:
            if not self._access_token:
                self._access_token = await self._get_access_token()
        return {
            "Authorization": f"Bearer {self._access_token}",
            "Accept": "application/json",
        }

    async def _request(self, method: str, path: str, **kwargs) -> dict:
        """Wrapper avec retry automatique si 401 (token expiré)."""
        headers = await self._headers()
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.request(
                method,
                f"{self.settings.booklore_api}{path}",
                headers=headers,
                **kwargs,
            )
            if response.status_code == 401:
                # Token expiré → renouveler et réessayer une fois
                async with self._lock:
                    self._access_token = await self._get_access_token()
                headers = {"Authorization": f"Bearer {self._access_token}", "Accept": "application/json"}
                response = await client.request(
                    method,
                    f"{self.settings.booklore_api}{path}",
                    headers=headers,
                    **kwargs,
                )
            response.raise_for_status()
            return response.json()

    async def get_all_books(self) -> list[dict]:
        """
        GET /api/v1/books
        Retourne tous les livres avec progression.
        """
        data = await self._request("GET", "/api/v1/books")
        # Normaliser selon la forme réelle de la réponse
        # Peut être une liste directe ou {"books": [...]} ou {"content": [...]}
        if isinstance(data, list):
            books = data
        else:
            books = data.get("books") or data.get("content") or data.get("data") or []
        return books

    async def get_currently_reading(self) -> list[dict]:
        """
        Retourne uniquement les livres EPUB en cours de lecture avec leur path résolu.

        Champs confirmés par la réponse réelle de l'API :
          - readStatus       : "READING" | "UNSET" | absent
          - epubProgress.percentage : float (ex: 41.2) — progression dans l'EPUB
          - koboProgress.percentage : float (ex: 42.0) — progression Kobo (légèrement différente)
          - primaryFile.filePath    : "/bookdrop/{sous-chemin}/{fichier}.epub"
          - primaryFile.bookType    : "EPUB" | "CBX" (ignorer les CBX/CBZ)
          - metadata.title          : str
          - metadata.authors        : list[str]
          - id                      : int

        Le path commence par "/bookdrop/" (chemin interne au container Booklore).
        On le remplace par BOOKS_PATH ("/books") pour Hermes.
        """
        books = await self.get_all_books()
        result = []
        for book in books:
            # Filtrer : en cours de lecture ET fichier EPUB (pas CBX/CBZ)
            if book.get("readStatus") != "READING":
                continue
            primary = book.get("primaryFile", {})
            if primary.get("bookType") != "EPUB":
                continue

            file_path = primary.get("filePath", "")
            if not file_path:
                continue

            # Préférer epubProgress (plus précis), fallback sur koboProgress
            epub_prog = book.get("epubProgress") or {}
            kobo_prog = book.get("koboProgress") or {}
            progress = epub_prog.get("percentage") or kobo_prog.get("percentage") or 0.0

            # Titre et auteur depuis metadata
            meta = book.get("metadata", {})
            authors = meta.get("authors", [])
            author = authors[0] if authors else ""

            result.append({
                "id": book.get("id"),
                "title": meta.get("title", ""),
                "author": author,
                "progress_percent": float(progress),
                "epub_path": self._resolve_epub_path(file_path),
                "epub_href": epub_prog.get("href"),  # position exacte dans l'EPUB si disponible
            })
        return result

    def progress_to_chapter(
        self,
        progress_percent: float,
        chapters: list,  # Liste de Chapter SQLAlchemy, ordonnés par order_index
    ) -> "Chapter | None":
        """
        Convertit un pourcentage global en chapitre correspondant.
        Hypothèse : les chapitres ont un poids équivalent.
        Ex : 35% sur 20 chapitres → chapitre 7
        """
        if not chapters:
            return None
        n = len(chapters)
        idx = min(int((progress_percent / 100) * n), n - 1)
        return chapters[idx]
```

### `hermes_core/services/adaptation_engine.py`

```python
"""
Algorithme d'adaptation du score utilisateur.
new_score = old_score * 0.8 + success_rate * 0.2
"""
from typing import Dict

GRAMMAR_CATEGORIES = [
    "past_simple", "present_perfect", "past_continuous",
    "present_simple", "conditionals", "passive_voice",
    "reported_speech", "articles", "prepositions",
]

class AdaptationEngine:
    def update_grammar_score(
        self,
        current_scores: Dict[str, float],
        category: str,
        is_correct: bool,
    ) -> Dict[str, float]:
        """Met à jour le score d'une catégorie grammaticale."""
        old_score = current_scores.get(category, 0.5)
        success_rate = 1.0 if is_correct else 0.0
        new_score = old_score * 0.8 + success_rate * 0.2
        return {**current_scores, category: round(new_score, 4)}

    def update_vocabulary_score(
        self,
        current_mastery: Dict[str, float],
        word: str,
        is_correct: bool,
    ) -> Dict[str, float]:
        """Met à jour la maîtrise d'un mot de vocabulaire."""
        old_score = current_mastery.get(word, 0.0)
        success_rate = 1.0 if is_correct else 0.0
        new_score = old_score * 0.8 + success_rate * 0.2
        return {**current_mastery, word: round(new_score, 4)}

    def get_weakest_grammar_categories(
        self,
        scores: Dict[str, float],
        n: int = 3,
    ) -> list[str]:
        """Retourne les n catégories grammaticales les plus faibles."""
        # Catégories non encore évaluées = score 0.0
        all_scores = {cat: scores.get(cat, 0.0) for cat in GRAMMAR_CATEGORIES}
        return sorted(all_scores, key=all_scores.get)[:n]

    def should_increase_difficulty(self, scores: Dict[str, float]) -> bool:
        avg = sum(scores.values()) / len(scores) if scores else 0
        return avg > 0.75
```

### `hermes_llm/client.py`

```python
"""
Client Ollama pour la génération d'exercices.
Deux modes : déterministe (grammaire) et créatif (compréhension).
"""
import httpx
import json
from typing import AsyncGenerator

class OllamaClient:
    def __init__(self, host: str, model: str):
        self.host = host.rstrip("/")
        self.model = model

    async def generate(
        self,
        prompt: str,
        temperature: float = 0.7,
        max_tokens: int = 2048,
    ) -> str:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{self.host}/api/generate",
                json={
                    "model": self.model,
                    "prompt": prompt,
                    "temperature": temperature,
                    "num_predict": max_tokens,
                    "stream": False,
                },
            )
            response.raise_for_status()
            return response.json()["response"]

    async def generate_deterministic(self, prompt: str) -> str:
        """Mode déterministe pour les exercices de grammaire."""
        return await self.generate(prompt, temperature=0.1)

    async def generate_creative(self, prompt: str) -> str:
        """Mode créatif pour les questions de compréhension."""
        return await self.generate(prompt, temperature=0.8)
```

### `hermes_llm/prompts/grammar.py`

```python
def build_grammar_prompt(
    cefr_level: str,
    grammar_categories: list[str],
    chapter_excerpt: str,
    n_exercises: int = 3,
) -> str:
    categories_str = ", ".join(grammar_categories)
    return f"""You are an English grammar teacher. Generate exactly {n_exercises} grammar exercises.

Student CEFR level: {cefr_level}
Target grammar: {categories_str}
Source text excerpt:
---
{chapter_excerpt[:1500]}
---

Generate {n_exercises} exercises. For each, respond ONLY with valid JSON in this format:
{{
  "exercises": [
    {{
      "subtype": "fill_blank" | "error_correction" | "sentence_transformation",
      "question": "...",
      "options": null or ["A", "B", "C", "D"],
      "correct_answer": "...",
      "grammar_category": "{grammar_categories[0]}"
    }}
  ]
}}

Rules:
- fill_blank: use ___ for the blank
- error_correction: provide a sentence with one grammatical error
- sentence_transformation: ask to rewrite using a specific structure
- Difficulty must match CEFR level {cefr_level}
- Use vocabulary and context from the source text
- Return ONLY the JSON, no preamble"""
```

### `hermes_llm/prompts/comprehension.py`

```python
def build_comprehension_prompt(
    cefr_level: str,
    chapter_text: str,
    n_questions: int = 5,
) -> str:
    return f"""You are an English reading comprehension teacher. Generate exactly {n_questions} comprehension questions.

Student CEFR level: {cefr_level}
Chapter text:
---
{chapter_text[:2000]}
---

Generate {n_questions} questions. Respond ONLY with valid JSON:
{{
  "exercises": [
    {{
      "subtype": "open_ended" | "multiple_choice",
      "question": "...",
      "options": null or ["A) ...", "B) ...", "C) ...", "D) ..."],
      "correct_answer": "..."
    }}
  ]
}}

- Mix open_ended and multiple_choice questions
- Questions must be answerable from the text only
- Adapt complexity to {cefr_level}
- Return ONLY the JSON"""
```

### `hermes_llm/prompts/vocabulary.py`

```python
def build_vocabulary_prompt(
    cefr_level: str,
    target_words: list[str],
    chapter_excerpt: str,
    n_exercises: int = 5,
) -> str:
    words_str = ", ".join(target_words[:10])
    return f"""You are an English vocabulary teacher. Generate {n_exercises} vocabulary exercises.

Student CEFR level: {cefr_level}
Target vocabulary: {words_str}
Source text:
---
{chapter_excerpt[:1000]}
---

Respond ONLY with valid JSON:
{{
  "exercises": [
    {{
      "subtype": "cloze" | "definition_matching" | "synonym_selection",
      "question": "...",
      "options": null or ["A) ...", "B) ...", "C) ...", "D) ..."],
      "correct_answer": "...",
      "vocabulary_item": "word_being_tested"
    }}
  ]
}}

- cloze: sentence from text with word removed, use ___
- definition_matching: give definition, ask for the word (MCQ)
- synonym_selection: give word, choose correct synonym (MCQ)
- Return ONLY the JSON"""
```

### `hermes_core/services/exercise_generator.py`

```python
"""
Orchestre la génération d'une session quotidienne complète.
"""
import json
from hermes_llm.client import OllamaClient
from hermes_llm.prompts import grammar, comprehension, vocabulary
from hermes_core.services.adaptation_engine import AdaptationEngine

class ExerciseGenerator:
    def __init__(self, ollama_client: OllamaClient):
        self.client = ollama_client
        self.adapter = AdaptationEngine()

    def _safe_parse(self, raw: str) -> dict:
        """Parse JSON LLM response, avec fallback robuste."""
        try:
            start = raw.index("{")
            end = raw.rindex("}") + 1
            return json.loads(raw[start:end])
        except (ValueError, json.JSONDecodeError):
            return {"exercises": []}

    async def generate_daily_batch(
        self,
        user,            # modèle SQLAlchemy User
        chapter_text: str,
        chapter_excerpt: str,
        target_words: list[str],
    ) -> dict:
        """
        Génère une session complète :
        - 5 questions de compréhension
        - 3 exercices de grammaire (catégories les plus faibles)
        - 5 exercices de vocabulaire
        """
        weakest = self.adapter.get_weakest_grammar_categories(
            user.grammar_scores, n=2
        )

        # Compréhension (mode créatif)
        comp_prompt = comprehension.build_comprehension_prompt(
            user.cefr_level, chapter_text, n_questions=5
        )
        comp_raw = await self.client.generate_creative(comp_prompt)
        comp_data = self._safe_parse(comp_raw)

        # Grammaire (mode déterministe)
        gram_prompt = grammar.build_grammar_prompt(
            user.cefr_level, weakest, chapter_excerpt, n_exercises=3
        )
        gram_raw = await self.client.generate_deterministic(gram_prompt)
        gram_data = self._safe_parse(gram_raw)

        # Vocabulaire (mode intermédiaire)
        vocab_prompt = vocabulary.build_vocabulary_prompt(
            user.cefr_level, target_words, chapter_excerpt, n_exercises=5
        )
        vocab_raw = await self.client.generate(vocab_prompt, temperature=0.4)
        vocab_data = self._safe_parse(vocab_raw)

        return {
            "comprehension": comp_data.get("exercises", []),
            "grammar": gram_data.get("exercises", []),
            "vocabulary": vocab_data.get("exercises", []),
        }
```

---

## 4. API Endpoints (FastAPI)

### `hermes_core/routers/daily.py`

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from hermes_core.database import get_db
# imports modèles, services...

router = APIRouter(prefix="/daily", tags=["daily"])

@router.get("/{user_id}")
async def get_daily_batch(user_id: int, db: AsyncSession = Depends(get_db)):
    """
    Retourne la session quotidienne en cours pour l'utilisateur.
    Si aucune session n'existe pour aujourd'hui, déclenche la génération.
    """
    # 1. Récupérer user
    # 2. Vérifier si DailyBatch du jour existe
    # 3. Si non : détecter le dernier chapitre complété
    # 4. Déclencher hermes_worker via Redis/Celery ou générer synchroniquement
    # 5. Retourner les exercices
    pass
```

### `hermes_core/routers/submit.py`

```python
@router.post("/submit/{user_id}/{exercise_id}")
async def submit_answer(
    user_id: int,
    exercise_id: int,
    payload: AnswerSchema,
    db: AsyncSession = Depends(get_db),
):
    """
    Enregistre la réponse et met à jour les scores utilisateur.
    Body: { "answer": "..." }
    """
    # 1. Récupérer exercise + user
    # 2. Comparer payload.answer avec correct_answer
    # 3. AdaptationEngine.update_grammar_score() ou update_vocabulary_score()
    # 4. Sauvegarder ExerciseAttempt
    # 5. Mettre à jour user.grammar_scores / vocabulary_mastery
    # 6. Retourner { correct: bool, correct_answer: str, new_score: float }
    pass
```

### Résumé des endpoints

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/daily` | Session du jour (génère si absente) |
| POST | `/submit/{exercise_id}` | Soumettre une réponse |
| GET | `/stats` | Scores globaux et progression |
| GET | `/stats/weaknesses` | Catégories grammaticales faibles |
| GET | `/progress` | Progression de lecture par livre |
| POST | `/books/parse` | Déclencher le parsing d'un EPUB |
| POST | `/progress/sync/booklore` | Synchroniser depuis Booklore |

---

## 5. Worker asynchrone

### `hermes_worker/tasks/generate_batch.py`

```python
"""
Tâche déclenchée après détection d'un chapitre complété.
Peut être lancée via :
- Celery (recommandé pour la prod)
- APScheduler (simple, si pas de Celery)
- Cron Docker (nuit, mode low-load)
"""
async def generate_batch_task(user_id: int, chapter_id: int):
    # 1. Charger user et chapitre depuis DB
    # 2. Récupérer sentences du chapitre
    # 3. Construire chapter_text et chapter_excerpt (500 premiers tokens)
    # 4. Extraire target_words : tokens avec POS NOUN/VERB/ADJ, lemma fréquence faible
    # 5. ExerciseGenerator.generate_daily_batch()
    # 6. Sauvegarder Exercise[] + DailyBatch en DB
    # 7. Logger succès / erreur
```

---

## 6. Algorithme d'adaptation — détail

```python
# Mise à jour du score après chaque réponse
new_score = old_score * 0.8 + success_rate * 0.2

# Seuils
MASTERED = 0.8        # Ne plus générer d'exercices pour cette catégorie
WEAK = 0.5            # Augmenter la probabilité dans le prochain batch
UNKNOWN = 0.0         # Catégorie jamais vue → priorité maximale

# Sélection des catégories pour le prochain batch
def select_grammar_categories(scores: dict, n: int = 3) -> list[str]:
    # 1. Ajouter les catégories jamais vues (score = 0.0)
    # 2. Trier par score croissant
    # 3. Exclure les catégories avec score >= 0.8 (maîtrisées)
    # 4. Retourner les n premières
```

---

## 7. Dépendances Python

```toml
# pyproject.toml (ou requirements.txt)
[dependencies]
fastapi = ">=0.110"
uvicorn = {extras = ["standard"]}
sqlalchemy = {extras = ["asyncio"]}
asyncpg = "*"
alembic = "*"
httpx = "*"
ebooklib = "*"
beautifulsoup4 = "*"
spacy = "*"
# Modèle spaCy : python -m spacy download en_core_web_sm
redis = "*"
celery = "*"         # Si worker distribué
apscheduler = "*"    # Alternative légère au worker
pydantic-settings = "*"
```

---

## 8. Ordre d'implémentation recommandé (MVP)

### Phase 1 — Fondations (semaine 1–2)
1. `docker-compose.yml` avec postgres + redis + ollama
2. Modèles SQLAlchemy + migration Alembic initiale
3. `EPUBParser` — parsing EPUB → sentences + tokens en DB
4. `OllamaClient` + prompts de base
5. `ExerciseGenerator.generate_daily_batch()` — version synchrone
6. Endpoint `GET /daily/{user_id}` — génération à la demande

### Phase 2 — Intégration Kobo + adaptation (semaine 3–4)
7. `KoboReader` — lecture KoboReader.sqlite
8. Endpoint `POST /progress/sync` — sync depuis Kobo
9. `AdaptationEngine` complet
10. Endpoint `POST /submit/{user_id}/{exercise_id}`
11. Endpoints `GET /stats` et `GET /weaknesses`

### Phase 3 — Worker + polish (semaine 5+)
12. `hermes_worker` avec Celery ou APScheduler
13. Audiobookshelf API client
14. Génération nocturne planifiée
15. Endpoint `GET /progress/{user_id}`
16. Spaced repetition (SRS) + export Anki

---

## 9. Notes importantes pour l'implémentation

### Parsing KEPUB
Les fichiers `.kepub.epub` (format Kobo) peuvent être lus par ebooklib après renommage en `.epub`. Ajouter une détection automatique de l'extension dans `EPUBParser`.

### Robustesse LLM
Le LLM peut générer du JSON malformé. Toujours utiliser `_safe_parse()` avec extraction de la sous-chaîne JSON plutôt qu'un `json.loads()` direct. Prévoir un fallback avec exercices pré-générés si la génération échoue 3 fois.

### Sélection des mots cibles pour le vocabulaire
Utiliser les tokens spaCy avec `pos_ in ("NOUN", "VERB", "ADJ")` et `is_stop == False`. Prioriser les mots dont `vocabulary_mastery` est < 0.5 ou absents du dictionnaire.

### Mode CPU-only Ollama
Recommander les modèles : `mistral:7b`, `llama3.2:3b` (plus rapide), `phi3:mini`. Configurer `num_ctx` à 2048 pour limiter la RAM. Planifier la génération la nuit pour éviter la latence.

### Sécurité du path KoboReader.sqlite
Monter le fichier en lecture seule (`:ro`) dans Docker. Ne jamais écrire dans la DB Kobo.

---

## 10. Fichiers de configuration et boilerplate

### `hermes_core/config.py`

```python
from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    database_url: str
    redis_url: str = "redis://redis:6379/0"
    ollama_host: str = "http://ollama:11434"
    ollama_model: str = "mistral:7b"

    # Booklore
    booklore_api: str = "http://booklore:6060"
    booklore_refresh_token: str  # JWT refresh token, stocké dans .env
    books_path: str = "/books"   # Volume monté depuis C:\Users\alexi\Desktop\booklore\bookdrop

    class Config:
        env_file = ".env"

@lru_cache()
def get_settings() -> Settings:
    return Settings()
```

### `hermes_core/database.py`

```python
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from hermes_core.config import get_settings

settings = get_settings()

engine = create_async_engine(settings.database_url, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
```

### `hermes_core/main.py`

```python
from fastapi import FastAPI
from contextlib import asynccontextmanager
from hermes_core.database import engine, Base
from hermes_core.routers import daily, submit, stats, progress, books

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Créer les tables au démarrage si elles n'existent pas
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield

app = FastAPI(title="Hermes", version="0.1.0", lifespan=lifespan)

app.include_router(daily.router)
app.include_router(submit.router)
app.include_router(stats.router)
app.include_router(progress.router)
app.include_router(books.router)

@app.get("/health")
async def health():
    return {"status": "ok"}
```

### `hermes_core/Dockerfile`

```dockerfile
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y build-essential && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN python -m spacy download en_core_web_sm

COPY . .

CMD ["uvicorn", "hermes_core.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
```

### `hermes_core/requirements.txt`

```
fastapi>=0.110.0
uvicorn[standard]>=0.29.0
sqlalchemy[asyncio]>=2.0.0
asyncpg>=0.29.0
alembic>=1.13.0
httpx>=0.27.0
ebooklib>=0.18
beautifulsoup4>=4.12.0
spacy>=3.7.0
redis>=5.0.0
celery>=5.3.0
apscheduler>=3.10.0
pydantic-settings>=2.0.0
lxml>=5.0.0
```

### `hermes_worker/Dockerfile`

```dockerfile
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y build-essential && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN python -m spacy download en_core_web_sm

COPY . .

CMD ["celery", "-A", "hermes_worker.worker", "worker", "--loglevel=info", "--concurrency=2"]
```

---

## 11. Schemas Pydantic

### `hermes_core/schemas/exercise.py`

```python
from pydantic import BaseModel
from typing import Optional

class ExerciseOut(BaseModel):
    id: int
    type: str
    subtype: str
    question: str
    options: Optional[list[str]] = None
    grammar_category: Optional[str] = None
    vocabulary_item: Optional[str] = None

    model_config = {"from_attributes": True}

class AnswerIn(BaseModel):
    answer: str

class AnswerResult(BaseModel):
    correct: bool
    correct_answer: str
    explanation: Optional[str] = None
    new_grammar_score: Optional[float] = None
    new_vocab_score: Optional[float] = None

class DailyBatchOut(BaseModel):
    batch_id: int
    chapter_title: str
    book_title: str
    comprehension: list[ExerciseOut]
    grammar: list[ExerciseOut]
    vocabulary: list[ExerciseOut]
    total_exercises: int
```

### `hermes_core/schemas/user.py`

```python
from pydantic import BaseModel
from typing import Optional

class UserCreate(BaseModel):
    username: str
    cefr_level: str = "B1"

class UserOut(BaseModel):
    id: int
    username: str
    cefr_level: str
    grammar_scores: dict
    vocabulary_mastery: dict

    model_config = {"from_attributes": True}

class WeaknessReport(BaseModel):
    weakest_grammar: list[dict]   # [{"category": "past_simple", "score": 0.34}]
    weakest_vocabulary: list[dict] # [{"word": "ephemeral", "score": 0.2}]
    recommended_focus: list[str]
```

### `hermes_core/schemas/progress.py`

```python
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
    synced_from: str   # "kobo", "audiobookshelf"
    new_chapters_detected: int
    batches_queued: int
```

---

## 12. Routers complets

### `hermes_core/routers/daily.py`

```python
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from hermes_core.database import get_db
from hermes_core.models.user import User
from hermes_core.models.book import Chapter, Sentence, Token
from hermes_core.models.exercise import DailyBatch, Exercise
from hermes_core.models.progress import ReadingProgress
from hermes_core.schemas.exercise import DailyBatchOut, ExerciseOut
from hermes_core.services.exercise_generator import ExerciseGenerator
from hermes_core.config import get_settings
from hermes_llm.client import OllamaClient
import datetime

router = APIRouter(prefix="/daily", tags=["daily"])

async def _get_or_generate_batch(
    user_id: int, db: AsyncSession
) -> DailyBatch:
    today = datetime.date.today()

    # Chercher un batch du jour
    result = await db.execute(
        select(DailyBatch)
        .where(DailyBatch.user_id == user_id)
        .where(DailyBatch.generated_at >= datetime.datetime.combine(today, datetime.time.min))
        .order_by(DailyBatch.generated_at.desc())
    )
    batch = result.scalar_one_or_none()
    if batch:
        return batch

    # Récupérer l'utilisateur
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")

    # Trouver le dernier chapitre complété sans batch généré
    result = await db.execute(
        select(ReadingProgress)
        .where(ReadingProgress.user_id == user_id)
        .order_by(ReadingProgress.completed_at.desc())
    )
    latest_progress = result.scalar_one_or_none()
    if not latest_progress:
        raise HTTPException(404, "No reading progress found. Complete a chapter first.")

    chapter = await db.get(Chapter, latest_progress.chapter_id)
    if not chapter:
        raise HTTPException(404, "Chapter not found")

    # Récupérer les phrases du chapitre
    result = await db.execute(
        select(Sentence).where(Sentence.chapter_id == chapter.id).order_by(Sentence.order_index)
    )
    sentences = result.scalars().all()
    chapter_text = " ".join(s.text for s in sentences)
    chapter_excerpt = chapter_text[:2000]

    # Extraire les mots cibles (NOUN, VERB, ADJ non stopwords)
    result = await db.execute(
        select(Token)
        .join(Sentence)
        .where(Sentence.chapter_id == chapter.id)
        .where(Token.pos.in_(["NOUN", "VERB", "ADJ"]))
    )
    tokens = result.scalars().all()
    candidate_words = list({t.lemma for t in tokens if len(t.lemma) > 3})
    # Prioriser les mots pas encore maîtrisés
    target_words = sorted(
        candidate_words,
        key=lambda w: user.vocabulary_mastery.get(w, 0.0)
    )[:15]

    # Générer les exercices
    settings = get_settings()
    ollama = OllamaClient(settings.ollama_host, settings.ollama_model)
    generator = ExerciseGenerator(ollama)
    exercises_data = await generator.generate_daily_batch(
        user=user,
        chapter_text=chapter_text,
        chapter_excerpt=chapter_excerpt,
        target_words=target_words,
    )

    # Créer le batch en DB
    batch = DailyBatch(user_id=user_id, chapter_id=chapter.id)
    db.add(batch)
    await db.flush()

    for ex_type, items in exercises_data.items():
        for item in items:
            exercise = Exercise(
                type=ex_type,
                subtype=item.get("subtype", ""),
                question=item.get("question", ""),
                options=item.get("options"),
                correct_answer=item.get("correct_answer", ""),
                grammar_category=item.get("grammar_category"),
                vocabulary_item=item.get("vocabulary_item"),
                source_chapter_id=chapter.id,
                batch_id=batch.id,
            )
            db.add(exercise)

    await db.commit()
    await db.refresh(batch)
    return batch


@router.get("/{user_id}", response_model=DailyBatchOut)
async def get_daily_batch(user_id: int, db: AsyncSession = Depends(get_db)):
    batch = await _get_or_generate_batch(user_id, db)

    result = await db.execute(
        select(Exercise).where(Exercise.batch_id == batch.id)
    )
    exercises = result.scalars().all()

    chapter = await db.get(Chapter, batch.chapter_id)
    from hermes_core.models.book import Book
    book = await db.get(Book, chapter.book_id)

    comp = [ExerciseOut.model_validate(e) for e in exercises if e.type == "comprehension"]
    gram = [ExerciseOut.model_validate(e) for e in exercises if e.type == "grammar"]
    vocab = [ExerciseOut.model_validate(e) for e in exercises if e.type == "vocabulary"]

    return DailyBatchOut(
        batch_id=batch.id,
        chapter_title=chapter.title or "",
        book_title=book.title if book else "",
        comprehension=comp,
        grammar=gram,
        vocabulary=vocab,
        total_exercises=len(exercises),
    )
```

### `hermes_core/routers/submit.py`

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from hermes_core.database import get_db
from hermes_core.models.user import User
from hermes_core.models.exercise import Exercise, ExerciseAttempt
from hermes_core.schemas.exercise import AnswerIn, AnswerResult
from hermes_core.services.adaptation_engine import AdaptationEngine

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

    # Évaluation (normalisation basique)
    user_ans = payload.answer.strip().lower()
    correct_ans = exercise.correct_answer.strip().lower()
    is_correct = user_ans == correct_ans

    # Enregistrer la tentative
    attempt = ExerciseAttempt(
        user_id=user_id,
        exercise_id=exercise_id,
        user_answer=payload.answer,
        is_correct=is_correct,
    )
    db.add(attempt)

    # Mettre à jour les scores
    new_grammar_score = None
    new_vocab_score = None

    if exercise.type == "grammar" and exercise.grammar_category:
        updated = adapter.update_grammar_score(
            user.grammar_scores or {},
            exercise.grammar_category,
            is_correct,
        )
        user.grammar_scores = updated
        new_grammar_score = updated.get(exercise.grammar_category)

    elif exercise.type == "vocabulary" and exercise.vocabulary_item:
        updated = adapter.update_vocabulary_score(
            user.vocabulary_mastery or {},
            exercise.vocabulary_item,
            is_correct,
        )
        user.vocabulary_mastery = updated
        new_vocab_score = updated.get(exercise.vocabulary_item)

    await db.commit()

    return AnswerResult(
        correct=is_correct,
        correct_answer=exercise.correct_answer,
        new_grammar_score=new_grammar_score,
        new_vocab_score=new_vocab_score,
    )
```

### `hermes_core/routers/stats.py`

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from hermes_core.database import get_db
from hermes_core.models.user import User
from hermes_core.models.exercise import ExerciseAttempt, DailyBatch
from hermes_core.schemas.user import UserOut, WeaknessReport
from hermes_core.services.adaptation_engine import AdaptationEngine

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
```

### `hermes_core/routers/progress.py`

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from hermes_core.database import get_db
from hermes_core.models.book import Book, Chapter
from hermes_core.models.progress import ReadingProgress
from hermes_core.schemas.progress import ProgressOut, SyncResult
from hermes_core.services.kobo_reader import KoboReader
from hermes_core.config import get_settings

router = APIRouter(prefix="/progress", tags=["progress"])

@router.get("/{user_id}", response_model=list[ProgressOut])
async def get_progress(user_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Book).join(Chapter).join(ReadingProgress)
        .where(ReadingProgress.user_id == user_id)
        .distinct()
    )
    books = result.scalars().all()

    output = []
    for book in books:
        total_result = await db.execute(
            select(func.count(Chapter.id)).where(Chapter.book_id == book.id)
        )
        total = total_result.scalar()

        completed_result = await db.execute(
            select(func.count(ReadingProgress.id))
            .join(Chapter)
            .where(Chapter.book_id == book.id)
            .where(ReadingProgress.user_id == user_id)
        )
        completed = completed_result.scalar()

        output.append(ProgressOut(
            book_title=book.title,
            author=book.author,
            chapters_completed=completed,
            chapters_total=total,
            percent_complete=round(completed / total * 100, 1) if total else 0.0,
            last_read=None,
        ))
    return output

@router.post("/sync/booklore", response_model=SyncResult)
async def sync_booklore(db: AsyncSession = Depends(get_db)):
    """
    Synchronise la progression depuis Booklore.
    - Détecte les livres en cours de lecture
    - Calcule le chapitre courant via le pourcentage
    - Crée un ReadingProgress si le chapitre a avancé
    - Déclenche la génération du batch si un nouveau chapitre est détecté
    """
    from hermes_core.services.booklore_client import BookloreClient
    from hermes_core.models.book import Book, Chapter
    from hermes_core.models.progress import ReadingProgress
    from sqlalchemy import select

    client = BookloreClient()
    try:
        reading_books = await client.get_currently_reading()
    except Exception as e:
        raise HTTPException(500, f"Cannot reach Booklore: {e}")

    new_count = 0
    for item in reading_books:
        # Trouver le livre en DB (par titre ou par path)
        result = await db.execute(
            select(Book).where(Book.file_path == item["epub_path"])
        )
        book = result.scalar_one_or_none()
        if not book:
            # Livre pas encore parsé → skip (l'utilisateur doit d'abord parser)
            continue

        # Récupérer les chapitres ordonnés
        result = await db.execute(
            select(Chapter)
            .where(Chapter.book_id == book.id)
            .order_by(Chapter.order_index)
        )
        chapters = result.scalars().all()
        if not chapters:
            continue

        current_chapter = client.progress_to_chapter(
            item["progress_percent"], chapters
        )
        if not current_chapter:
            continue

        # Vérifier si ce chapitre est déjà enregistré
        existing = await db.execute(
            select(ReadingProgress)
            .where(ReadingProgress.chapter_id == current_chapter.id)
        )
        if existing.scalar_one_or_none():
            continue

        db.add(ReadingProgress(
            chapter_id=current_chapter.id,
            source="booklore",
        ))
        new_count += 1

    await db.commit()
    return SyncResult(
        synced_from="booklore",
        new_chapters_detected=new_count,
        batches_queued=new_count,
    )
```

### `hermes_core/routers/books.py`

```python
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from pathlib import Path
from hermes_core.database import get_db
from hermes_core.models.book import Book, Chapter, Sentence, Token
from hermes_core.services.epub_parser import EPUBParser

router = APIRouter(prefix="/books", tags=["books"])

class ParseRequest(BaseModel):
    file_path: str
    title: str
    author: str = ""

@router.post("/parse")
async def parse_book(
    payload: ParseRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    path = Path(payload.file_path)
    if not path.exists():
        raise HTTPException(404, f"File not found: {payload.file_path}")

    # Vérifier si déjà parsé
    from sqlalchemy import select
    result = await db.execute(select(Book).where(Book.file_path == payload.file_path))
    existing = result.scalar_one_or_none()
    if existing and existing.parsed:
        return {"message": "Already parsed", "book_id": existing.id}

    book = existing or Book(
        title=payload.title,
        author=payload.author,
        file_path=payload.file_path,
        format=path.suffix.lstrip("."),
    )
    if not existing:
        db.add(book)
        await db.flush()

    background_tasks.add_task(_parse_and_store, book.id, payload.file_path, db)
    return {"message": "Parsing started", "book_id": book.id}


async def _parse_and_store(book_id: int, file_path: str, db: AsyncSession):
    """Tâche de fond : parse le fichier et stocke tout en DB."""
    try:
        parser = EPUBParser(file_path)
        chapters_data = parser.get_chapters()

        book = await db.get(Book, book_id)

        for chap_data in chapters_data:
            chapter = Chapter(
                book_id=book_id,
                title=str(chap_data["title"])[:200],
                order_index=chap_data["order_index"],
            )
            db.add(chapter)
            await db.flush()

            sentences_data = parser.parse_sentences(chap_data["raw_text"])
            for sent_data in sentences_data:
                sentence = Sentence(
                    chapter_id=chapter.id,
                    text=sent_data["text"],
                    order_index=sent_data["order_index"],
                )
                db.add(sentence)
                await db.flush()

                for tok_data in sent_data["tokens"]:
                    token = Token(
                        sentence_id=sentence.id,
                        word=tok_data["word"],
                        lemma=tok_data["lemma"],
                        pos=tok_data["pos"],
                    )
                    db.add(token)

        book.parsed = True
        await db.commit()

    except Exception as e:
        await db.rollback()
        raise
```

---

## 13. Worker et tâches Celery

### `hermes_worker/worker.py`

```python
from celery import Celery
from hermes_core.config import get_settings

settings = get_settings()

app = Celery(
    "hermes_worker",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["hermes_worker.tasks.generate_batch", "hermes_worker.tasks.sync_progress"],
)

app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    # Planification nocturne (3h du matin)
    beat_schedule={
        "nightly-batch-generation": {
            "task": "hermes_worker.tasks.generate_batch.check_and_generate_pending",
            "schedule": 3600 * 24,  # Toutes les 24h
            "options": {"eta": "08:00"},
        },
        "kobo-sync": {
            "task": "hermes_worker.tasks.sync_progress.sync_all_users",
            "schedule": 3600,  # Toutes les heures
        },
    },
)
```

### `hermes_worker/tasks/generate_batch.py`

```python
from hermes_worker.worker import app
import asyncio

@app.task(bind=True, max_retries=3, default_retry_delay=60)
def generate_batch_for_user(self, user_id: int, chapter_id: int):
    """
    Tâche Celery déclenchée après détection d'un chapitre complété.
    Génère la session d'exercices pour cet utilisateur et ce chapitre.
    """
    try:
        asyncio.run(_async_generate(user_id, chapter_id))
    except Exception as exc:
        raise self.retry(exc=exc)

async def _async_generate(user_id: int, chapter_id: int):
    from sqlalchemy.ext.asyncio import AsyncSession
    from hermes_core.database import AsyncSessionLocal
    from hermes_core.models.user import User
    from hermes_core.models.book import Chapter, Sentence, Token
    from hermes_core.models.exercise import DailyBatch, Exercise
    from hermes_core.services.exercise_generator import ExerciseGenerator
    from hermes_llm.client import OllamaClient
    from hermes_core.config import get_settings
    from sqlalchemy import select

    settings = get_settings()

    async with AsyncSessionLocal() as db:
        user = await db.get(User, user_id)
        chapter = await db.get(Chapter, chapter_id)
        if not user or not chapter:
            return

        result = await db.execute(
            select(Sentence).where(Sentence.chapter_id == chapter_id).order_by(Sentence.order_index)
        )
        sentences = result.scalars().all()
        chapter_text = " ".join(s.text for s in sentences)

        result = await db.execute(
            select(Token).join(Sentence)
            .where(Sentence.chapter_id == chapter_id)
            .where(Token.pos.in_(["NOUN", "VERB", "ADJ"]))
        )
        tokens = result.scalars().all()
        target_words = list({t.lemma for t in tokens if len(t.lemma) > 3})[:15]

        ollama = OllamaClient(settings.ollama_host, settings.ollama_model)
        generator = ExerciseGenerator(ollama)
        exercises_data = await generator.generate_daily_batch(
            user=user,
            chapter_text=chapter_text,
            chapter_excerpt=chapter_text[:2000],
            target_words=target_words,
        )

        batch = DailyBatch(user_id=user_id, chapter_id=chapter_id)
        db.add(batch)
        await db.flush()

        for ex_type, items in exercises_data.items():
            for item in items:
                db.add(Exercise(
                    type=ex_type,
                    subtype=item.get("subtype", ""),
                    question=item.get("question", ""),
                    options=item.get("options"),
                    correct_answer=item.get("correct_answer", ""),
                    grammar_category=item.get("grammar_category"),
                    vocabulary_item=item.get("vocabulary_item"),
                    source_chapter_id=chapter_id,
                    batch_id=batch.id,
                ))

        await db.commit()


@app.task
def check_and_generate_pending():
    """
    Vérifie tous les utilisateurs pour des chapitres complétés
    sans batch généré, et lance la génération.
    """
    asyncio.run(_check_pending())

async def _check_pending():
    from hermes_core.database import AsyncSessionLocal
    from hermes_core.models.progress import ReadingProgress
    from hermes_core.models.exercise import DailyBatch
    from sqlalchemy import select, not_, exists

    async with AsyncSessionLocal() as db:
        # Chapitres complétés sans batch existant
        subq = select(DailyBatch.chapter_id).where(
            DailyBatch.user_id == ReadingProgress.user_id
        )
        result = await db.execute(
            select(ReadingProgress).where(not_(exists(subq)))
        )
        pending = result.scalars().all()
        for p in pending:
            generate_batch_for_user.delay(p.user_id, p.chapter_id)
```

### `hermes_worker/tasks/sync_progress.py`

```python
from hermes_worker.worker import app
import asyncio

@app.task
def sync_all_users():
    """Synchronise la progression Booklore (tourne toutes les heures)."""
    asyncio.run(_sync())

async def _sync():
    from hermes_core.database import AsyncSessionLocal
    from hermes_core.models.book import Book, Chapter
    from hermes_core.models.progress import ReadingProgress
    from hermes_core.services.booklore_client import BookloreClient
    from sqlalchemy import select

    client = BookloreClient()
    try:
        reading_books = await client.get_currently_reading()
    except Exception:
        return  # Booklore injoignable, skip silencieux

    async with AsyncSessionLocal() as db:
        new_chapters = []

        for item in reading_books:
            result = await db.execute(
                select(Book).where(Book.file_path == item["epub_path"])
            )
            book = result.scalar_one_or_none()
            if not book:
                continue

            result = await db.execute(
                select(Chapter)
                .where(Chapter.book_id == book.id)
                .order_by(Chapter.order_index)
            )
            chapters = result.scalars().all()
            if not chapters:
                continue

            current_chapter = client.progress_to_chapter(
                item["progress_percent"], chapters
            )
            if not current_chapter:
                continue

            existing = await db.execute(
                select(ReadingProgress)
                .where(ReadingProgress.chapter_id == current_chapter.id)
            )
            if existing.scalar_one_or_none():
                continue

            db.add(ReadingProgress(chapter_id=current_chapter.id, source="booklore"))
            new_chapters.append(current_chapter.id)

        await db.commit()

    # Déclencher la génération pour les nouveaux chapitres détectés
    from hermes_worker.tasks.generate_batch import generate_batch_for_user
    USER_ID = 1  # Mono-utilisateur
    for chapter_id in new_chapters:
        generate_batch_for_user.delay(USER_ID, chapter_id)
```

---

## 14. Audiobookshelf (Phase 3 — hors MVP)

Audiobookshelf sera intégré en Phase 3 pour la synchronisation des livres audio. Le client suivra le même pattern que `BookloreClient` (token Bearer, retry 401). Pour l'instant, toute la progression passe par Booklore.

---

## 15. Alembic — migration initiale

### `alembic/env.py` (section à modifier)

```python
# Importer tous les modèles pour qu'Alembic les détecte
from hermes_core.database import Base
from hermes_core.models import user, book, exercise, progress  # noqa

target_metadata = Base.metadata
```

### Commandes Alembic

```bash
# Initialiser (une seule fois)
alembic init alembic

# Générer la migration initiale
alembic revision --autogenerate -m "initial schema"

# Appliquer
alembic upgrade head

# Annuler la dernière migration
alembic downgrade -1
```

---

## 16. Scripts utilitaires

### `scripts/init_db.py`

```python
"""Lance la migration et crée un utilisateur de départ."""
import asyncio
from hermes_core.database import engine, Base
from hermes_core.models.user import User
from hermes_core.database import AsyncSessionLocal

async def main():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("✓ Tables créées")

    async with AsyncSessionLocal() as db:
        user = User(username="default", cefr_level="B2")
        db.add(user)
        await db.commit()
        print(f"✓ Utilisateur créé : id={user.id}")

if __name__ == "__main__":
    asyncio.run(main())
```

### `scripts/seed_user.py`

```python
"""Crée un utilisateur avec des scores de départ pour les tests."""
import asyncio
from hermes_core.database import AsyncSessionLocal
from hermes_core.models.user import User

async def main():
    async with AsyncSessionLocal() as db:
        user = User(
            username="testuser",
            cefr_level="B1",
            grammar_scores={
                "past_simple": 0.4,
                "present_perfect": 0.2,
                "conditionals": 0.0,
                "passive_voice": 0.6,
            },
            vocabulary_mastery={},
        )
        db.add(user)
        await db.commit()
        print(f"✓ Test user created: id={user.id}")

if __name__ == "__main__":
    asyncio.run(main())
```

---

## 17. Instructions pour Claude Code

> Sauvegarder comme `CLAUDE.md` à la racine du projet. Claude Code le lit automatiquement à chaque session.

```markdown
# CLAUDE.md — Hermes

## Contexte
Hermes est un moteur d'apprentissage de l'anglais adaptatif, auto-hébergé, **mono-utilisateur** (USER_ID = 1 hardcodé).
Voir hermes-plan.md pour l'architecture complète.

## Environnement
- Booklore tourne sur la même machine Windows (Docker, port 6060)
- Le bookdrop est monté sur `/bookdrop` dans le container Booklore, sur `/books` dans Hermes
- `BookloreClient._resolve_epub_path()` fait juste : `/bookdrop/...` → `/books/...`
- Paths réels observés dans l'API :
  - `/bookdrop/Hushabye_epub_04-08-21v1/Hushabye_epub_04-08-21v1 (2021).epub`
  - `/bookdrop/CHAPTER ONE/Harry Potter.../Harry Potter....epub`
  - `/bookdrop/Beaton, M.C/Agatha Raisin.../Agatha Raisin....epub`
- Booklore joignable via `http://host.docker.internal:6060` depuis les containers Hermes

## Champs API Booklore confirmés (GET /api/v1/books)
- `readStatus` : `"READING"` pour les livres en cours (pas `currentlyReading`)
- `epubProgress.percentage` : float, source préférée (ex: 41.2)
- `koboProgress.percentage` : float, fallback si epubProgress absent
- `primaryFile.filePath` : path complet avec préfixe `/bookdrop/`
- `primaryFile.bookType` : `"EPUB"` ou `"CBX"` — ignorer les CBX (mangas)
- `metadata.title`, `metadata.authors` (liste)
- Pas de champ `currentlyReading` — utiliser `readStatus == "READING"`

## Stack
- Python 3.11, FastAPI, SQLAlchemy async, Alembic
- PostgreSQL, Redis, Ollama (CPU-only)
- Docker Compose sur Windows

## Conventions
- Mono-user : `USER_ID = 1` comme constante, pas de `user_id` dans les routes
- Toujours `async/await` pour DB et HTTP
- Colonnes JSON SQLAlchemy : utiliser `flag_modified(obj, "field_name")` après mutation d'un dict
- LLM : toujours `_safe_parse()` — le JSON peut être malformé
- Ne jamais écrire dans `/books` (monté `:ro`)

## Ordre de démarrage
1. `docker-compose up postgres redis ollama`
2. `python scripts/init_db.py`
3. `docker-compose up hermes-core`
4. `POST /books/parse` avec le path d'un EPUB
5. `POST /progress/sync/booklore`
6. `GET /daily`

## Commandes utiles
```bash
docker-compose up --build
docker-compose exec hermes-core alembic upgrade head
docker-compose exec ollama ollama pull mistral:7b
docker-compose logs -f hermes-worker
# Inspecter la réponse Booklore manuellement :
curl http://localhost:6060/api/v1/books -H "Authorization: Bearer {token}" | python -m json.tool | head -80
```

## Priorités MVP (Phase 1)
1. `BookloreClient.get_currently_reading()` + résolution de path Windows→Linux
2. `EPUBParser` — ebooklib + spaCy → sentences + tokens en DB
3. `POST /books/parse` + `POST /progress/sync/booklore`
4. `OllamaClient` + 3 prompts (grammar, comprehension, vocabulary)
5. `GET /daily` + `POST /submit/{exercise_id}`

## Points d'attention critiques
- **Path /bookdrop→/books** : simple remplacement de préfixe, pas de conversion Windows
- **readStatus="READING"** : c'est le flag à utiliser, pas `currentlyReading`
- **Filtrer les CBX** : la bibliothèque contient des mangas (Detective Conan) en `.cbz` — ignorer `bookType != "EPUB"`
- **epubProgress > koboProgress** : préférer `epubProgress.percentage`, le pourcentage Kobo peut légèrement diverger
- **Pourcentage→chapitre** : chapitres de poids égal par défaut, améliorer si nécessaire avec nb de phrases
- **KEPUB** : renommer `.kepub.epub` → `.epub` temporairement avant ebooklib
- **Ollama timeout** : `timeout=120.0` dans httpx
- **Modèles CPU** : `mistral:7b`, `llama3.2:3b`, `phi3:mini`
- **spaCy** : `python -m spacy download en_core_web_sm` dans le Dockerfile
```
