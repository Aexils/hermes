"""
Client Audiobookshelf — synchronise les livres audio depuis ABS vers Hermes.
"""
import logging
import re
from difflib import SequenceMatcher
from pathlib import Path

import httpx

log = logging.getLogger(__name__)


def _normalize(title: str) -> str:
    """Normalise un titre pour comparaison : lowercase, sans ponctuation, sans articles."""
    t = title.lower()
    t = re.sub(r"[''\".,!?:;()\-]", "", t)
    t = re.sub(r"\b(the|a|an)\b", "", t)
    return re.sub(r"\s+", " ", t).strip()


def _fuzzy_match_book(audio_title: str, books: list) -> object | None:
    """Retourne le livre dont le titre est le plus proche (ratio ≥ 0.7)."""
    norm_audio = _normalize(audio_title)
    best_ratio = 0.0
    best_book = None
    for book in books:
        if book.audio_item_id:  # déjà associé
            continue
        ratio = SequenceMatcher(None, norm_audio, _normalize(book.title)).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best_book = book
    if best_ratio >= 0.7:
        log.info(f"ABS: matched '{audio_title}' → '{best_book.title}' (ratio={best_ratio:.2f})")
        return best_book
    log.info(f"ABS: no match for '{audio_title}' (best ratio={best_ratio:.2f})")
    return None


class AudiobookshelfClient:
    def __init__(self, base_url: str, token: str, local_books_dir: str = "/audiobooks"):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.local_books_dir = Path(local_books_dir)
        self._headers = {"Authorization": f"Bearer {token}"}

    async def _get(self, path: str) -> dict:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(f"{self.base_url}{path}", headers=self._headers)
            resp.raise_for_status()
            return resp.json()

    async def list_libraries(self) -> list[dict]:
        data = await self._get("/api/libraries")
        return data.get("libraries", [])

    async def list_items(self, library_id: str) -> list[dict]:
        """Retourne tous les items d'une librairie (livres audio)."""
        data = await self._get(f"/api/libraries/{library_id}/items?minified=1&limit=500")
        return data.get("results", [])

    async def get_item(self, item_id: str) -> dict:
        return await self._get(f"/api/items/{item_id}")

    def resolve_local_path(self, abs_path: str) -> Path | None:
        """
        Tente de résoudre le chemin ABS vers un chemin local monté.
        ABS retourne par ex. /audiobooks/Author/Book/file.m4b
        Si ce chemin existe dans le container → on l'utilise directement.
        """
        p = Path(abs_path)
        if p.exists():
            return p

        # Essaie sous local_books_dir avec juste le nom de fichier
        candidate = self.local_books_dir / p.name
        if candidate.exists():
            return candidate

        # Essaie avec les 2 derniers segments (Author/Book/file.m4b)
        parts = p.parts
        if len(parts) >= 3:
            candidate = self.local_books_dir / Path(*parts[-3:])
            if candidate.exists():
                return candidate

        return None

    def resolve_local_dir(self, abs_path: str) -> Path | None:
        """
        Résout le répertoire parent d'un chemin ABS vers un dossier local.
        Utilisé pour les audiobooks multi-fichiers (1 fichier par chapitre).
        """
        p = Path(abs_path)
        parent = p.parent

        if parent.exists() and parent.is_dir():
            return parent

        candidate = self.local_books_dir / parent.name
        if candidate.exists() and candidate.is_dir():
            return candidate

        parts = parent.parts
        if len(parts) >= 2:
            candidate = self.local_books_dir / Path(*parts[-2:])
            if candidate.exists() and candidate.is_dir():
                return candidate

        return None

    async def sync_books(self, db) -> dict:
        """
        Synchronise tous les livres audio depuis ABS vers la table books.
        Retourne un dict de stats.
        """
        from sqlalchemy import select
        from hermes_core.models.book import Book

        stats = {"found": 0, "new": 0, "updated": 0}

        try:
            libraries = await self.list_libraries()
        except Exception as e:
            log.error(f"ABS sync failed (cannot reach server): {e}")
            return stats

        for lib in libraries:
            # ABS retourne "book" pour les librairies d'audiobooks/ebooks
            # On accepte aussi "audiobook" au cas où
            media_type = lib.get("mediaType", "")
            if media_type not in ("book", "audiobook"):
                log.info(f"ABS: skipping library '{lib.get('name')}' (mediaType={media_type!r})")
                continue

            log.info(f"ABS: syncing library '{lib.get('name')}' ({media_type})")
            items = await self.list_items(lib["id"])
            log.info(f"ABS: found {len(items)} items in '{lib.get('name')}'")
            for item in items:
                stats["found"] += 1
                item_id = item.get("id") or item.get("libraryItemId")
                if item_id:
                    await self._sync_item(item_id, db, stats)

        return stats

    async def _sync_item(self, item_id: str, db, stats: dict):
        from hermes_core.models.book import Book
        from sqlalchemy import select

        try:
            item = await self.get_item(item_id)
        except Exception as e:
            log.warning(f"ABS: could not fetch item {item_id}: {e}")
            return

        meta = item.get("media", {}).get("metadata", {})
        title = meta.get("title", "Unknown")
        author = meta.get("authorName", "")

        audio_files = item.get("media", {}).get("audioFiles", [])
        if not audio_files:
            return

        first_file_path = audio_files[0].get("metadata", {}).get("path", "")

        # Multi-fichiers (1 par chapitre) → stocker le répertoire parent
        if len(audio_files) > 1:
            local_path = self.resolve_local_dir(first_file_path) if first_file_path else None
            fallback = str(Path(first_file_path).parent) if first_file_path else ""
        else:
            local_path = self.resolve_local_path(first_file_path)
            fallback = first_file_path

        result = await db.execute(
            select(Book).where(Book.audio_item_id == item_id)
        )
        existing = result.scalar_one_or_none()

        resolved_path = str(local_path) if local_path else fallback

        if existing:
            existing.audio_path = resolved_path
            stats["updated"] += 1
        else:
            # Cherche si le livre existe déjà (EPUB) par titre — match flou
            result2 = await db.execute(select(Book))
            all_books = result2.scalars().all()
            matched = _fuzzy_match_book(title, all_books)

            if matched:
                # Associe l'audiobook à l'EPUB existant
                matched.audio_item_id = item_id
                matched.audio_path = resolved_path
                stats["updated"] += 1
            else:
                # Nouveau livre audio uniquement
                book = Book(
                    title=title,
                    author=author,
                    file_path=f"abs://{item_id}",
                    format="audio",
                    parsed=False,
                    audio_item_id=item_id,
                    audio_path=resolved_path,
                )
                db.add(book)
                stats["new"] += 1

        await db.flush()
