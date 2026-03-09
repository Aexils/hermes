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
"""
import httpx
import asyncio
from hermes_core.config import get_settings


class BookloreClient:
    def __init__(self):
        self.settings = get_settings()
        self._access_token: str | None = None
        self._refresh_token: str = self.settings.booklore_refresh_token
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
        """
        BOOKLORE_PREFIX = "/bookdrop/"
        HERMES_PREFIX = self.settings.books_path.rstrip("/") + "/"

        if file_path_from_api.startswith(BOOKLORE_PREFIX):
            return HERMES_PREFIX + file_path_from_api[len(BOOKLORE_PREFIX):]
        # Fallback si le préfixe change
        return file_path_from_api.replace("/bookdrop", self.settings.books_path)

    async def _get_access_token(self) -> str:
        """
        Obtient un access token.
        - Si username+password sont configurés → login direct (préféré, évite la rotation)
        - Sinon → refresh token rotatif (moins fiable après redémarrage)
        """
        async with httpx.AsyncClient(timeout=10.0) as client:
            if self.settings.booklore_username and self.settings.booklore_password:
                response = await client.post(
                    f"{self.settings.booklore_api}/api/v1/auth/login",
                    json={
                        "username": self.settings.booklore_username,
                        "password": self.settings.booklore_password,
                    },
                )
                response.raise_for_status()
                data = response.json()
                # Stocker aussi le nouveau refresh token pour la session
                if new_refresh := data.get("refreshToken"):
                    self._refresh_token = new_refresh
                return data.get("accessToken") or data.get("token")
            else:
                response = await client.post(
                    f"{self.settings.booklore_api}/api/v1/auth/refresh",
                    json={"refreshToken": self._refresh_token},
                )
                response.raise_for_status()
                data = response.json()
                # Booklore retourne un nouveau refreshToken à chaque appel (rotation)
                if new_refresh := data.get("refreshToken"):
                    self._refresh_token = new_refresh
                return data.get("accessToken") or data.get("token")

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
          - epubProgress.percentage : float (ex: 41.2)
          - koboProgress.percentage : float (ex: 42.0)
          - primaryFile.filePath    : "/bookdrop/{sous-chemin}/{fichier}.epub"
          - primaryFile.bookType    : "EPUB" | "CBX" (ignorer les CBX/CBZ)
          - metadata.title          : str
          - metadata.authors        : list[str]
          - id                      : int
        """
        books = await self.get_all_books()
        result = []
        for book in books:
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

            meta = book.get("metadata", {})
            authors = meta.get("authors", [])
            author = authors[0] if authors else ""

            result.append({
                "id": book.get("id"),
                "title": meta.get("title", ""),
                "author": author,
                "progress_percent": float(progress),
                "epub_path": self._resolve_epub_path(file_path),
                "epub_href": epub_prog.get("href"),
            })
        return result

    def progress_to_chapter(
        self,
        progress_percent: float,
        chapters: list,
    ):
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
