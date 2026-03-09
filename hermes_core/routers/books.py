from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request
from fastapi.responses import StreamingResponse, FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from pathlib import Path
import httpx
from hermes_core.database import get_db, AsyncSessionLocal
from hermes_core.models.book import Book, Chapter, Sentence, Token
from hermes_core.services.epub_parser import EPUBParser
from hermes_core.services.book_anecdotes import get_or_generate_anecdotes
from hermes_core.services.audiobookshelf_client import AudiobookshelfClient
from hermes_core.config import get_settings
from hermes_llm.client import OllamaClient

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
        await db.commit()
        await db.refresh(book)

    background_tasks.add_task(_parse_and_store, book.id, payload.file_path)
    return {"message": "Parsing started", "book_id": book.id}


@router.get("/")
async def list_books(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Book))
    books = result.scalars().all()
    return [
        {
            "id": b.id,
            "title": b.title,
            "author": b.author,
            "file_path": b.file_path,
            "format": b.format,
            "parsed": b.parsed,
        }
        for b in books
    ]


@router.get("/{book_id}/anecdotes")
async def get_anecdotes(book_id: int, db: AsyncSession = Depends(get_db)):
    book = await db.get(Book, book_id)
    if not book:
        raise HTTPException(404, "Book not found")
    settings = get_settings()
    ollama = OllamaClient(settings.ollama_host, settings.ollama_model)
    anecdotes = await get_or_generate_anecdotes(book, db, ollama)
    return {"anecdotes": anecdotes}


@router.get("/abs/items")
async def list_abs_items(db: AsyncSession = Depends(get_db)):
    """Liste les items ABS avec leur correspondance en DB."""
    settings = get_settings()
    token = settings.audiobookshelf_token
    if not token:
        raise HTTPException(400, "AUDIOBOOKSHELF_TOKEN not configured")

    base = settings.audiobookshelf_api.rstrip("/")
    headers = {"Authorization": f"Bearer {token}"}

    result = await db.execute(select(Book))
    books = result.scalars().all()
    matched_map = {b.audio_item_id: b.id for b in books if b.audio_item_id}

    all_items = []
    async with httpx.AsyncClient(timeout=15) as client:
        libs_resp = await client.get(f"{base}/api/libraries", headers=headers)
        if libs_resp.status_code != 200:
            raise HTTPException(502, f"ABS libraries error: {libs_resp.status_code}")
        libraries = libs_resp.json().get("libraries", [])
        for lib in libraries:
            items_resp = await client.get(
                f"{base}/api/libraries/{lib['id']}/items?minified=1&limit=100",
                headers=headers,
            )
            if items_resp.status_code == 200:
                for item in items_resp.json().get("results", []):
                    item_id = item.get("id")
                    media = item.get("media", {})
                    metadata = media.get("metadata", {})
                    all_items.append({
                        "id": item_id,
                        "title": metadata.get("title", item.get("title", "")),
                        "duration": media.get("duration"),
                        "matched_book_id": matched_map.get(item_id),
                    })
    return all_items


@router.get("/abs/debug")
async def abs_debug():
    """Debug : retourne les librairies et items bruts depuis ABS."""
    settings = get_settings()
    base = settings.audiobookshelf_api.rstrip("/")
    token = settings.audiobookshelf_token
    result: dict = {"api": base, "token_set": bool(token)}
    if not token:
        result["error"] = "AUDIOBOOKSHELF_TOKEN not configured"
        return result
    headers = {"Authorization": f"Bearer {token}"}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            try:
                libs_resp = await client.get(f"{base}/api/libraries", headers=headers)
                result["libraries_status"] = libs_resp.status_code
                if libs_resp.status_code != 200:
                    result["libraries_error"] = libs_resp.text[:500]
                    return result
                libraries = libs_resp.json().get("libraries", [])
                result["libraries"] = []
                for lib in libraries:
                    lib_info: dict = {
                        "id": lib.get("id"),
                        "name": lib.get("name"),
                        "mediaType": lib.get("mediaType"),
                    }
                    try:
                        items_resp = await client.get(
                            f"{base}/api/libraries/{lib['id']}/items?minified=1&limit=5",
                            headers=headers,
                        )
                        lib_info["items_status"] = items_resp.status_code
                        if items_resp.status_code == 200:
                            data = items_resp.json()
                            lib_info["items_total"] = data.get("total", 0)
                            lib_info["items_sample"] = data.get("results", [])[:2]
                        else:
                            lib_info["items_error"] = items_resp.text[:200]
                    except Exception as e:
                        lib_info["items_exception"] = str(e)
                    result["libraries"].append(lib_info)
            except httpx.ConnectError as e:
                result["error"] = f"Cannot connect to ABS at {base}: {e}"
            except httpx.TimeoutException:
                result["error"] = f"Timeout connecting to {base}"
    except Exception as e:
        result["error"] = f"Unexpected error: {e}"
    return result


@router.post("/sync/audiobookshelf")
async def sync_audiobookshelf(db: AsyncSession = Depends(get_db)):
    """Synchronise les livres audio depuis Audiobookshelf."""
    settings = get_settings()
    if not settings.audiobookshelf_token:
        raise HTTPException(400, "AUDIOBOOKSHELF_TOKEN not configured")
    client = AudiobookshelfClient(
        settings.audiobookshelf_api,
        settings.audiobookshelf_token,
        settings.audiobooks_path,
    )
    stats = await client.sync_books(db)
    await db.commit()
    return {"synced": True, **stats}


@router.post("/{book_id}/transcribe")
async def start_transcription(book_id: int, db: AsyncSession = Depends(get_db)):
    """Lance la transcription Whisper d'un livre audio en tâche de fond."""
    book = await db.get(Book, book_id)
    if not book:
        raise HTTPException(404, "Book not found")
    if not book.audio_path:
        raise HTTPException(400, "Book has no audio file (sync from Audiobookshelf first)")
    if book.transcription_status == "running":
        return {"message": "Already running"}

    from celery import Celery
    book.transcription_status = "pending"
    await db.commit()
    celery_app = Celery(broker=get_settings().redis_url)
    celery_app.send_task(
        "hermes_worker.tasks.transcribe_book.transcribe_book",
        args=[book_id],
    )
    return {"message": "Transcription queued", "book_id": book_id}


@router.get("/{book_id}/transcription/status")
async def transcription_status(book_id: int, db: AsyncSession = Depends(get_db)):
    book = await db.get(Book, book_id)
    if not book:
        raise HTTPException(404, "Book not found")
    return {
        "book_id": book_id,
        "transcribed": book.transcribed,
        "status": book.transcription_status,
    }


@router.get("/{book_id}/audio/{file_index}")
async def stream_audio(book_id: int, file_index: int, request: Request, db: AsyncSession = Depends(get_db)):
    """
    Proxy audio : sert le fichier audio d'un livre.
    Supporte les Range requests pour le seeking HTML5.
    """
    book = await db.get(Book, book_id)
    if not book:
        raise HTTPException(404, "Book not found")

    # Fichier(s) local/locaux monté(s) → serve directement (Range géré par FileResponse)
    AUDIO_EXTS = {'.mp3', '.m4a', '.m4b', '.ogg', '.flac', '.wav', '.aac', '.opus'}
    if book.audio_path:
        local = Path(book.audio_path)
        if local.is_dir():
            # Multi-fichiers : 1 fichier par chapitre, triés par nom
            files = sorted(f for f in local.iterdir() if f.suffix.lower() in AUDIO_EXTS)
            if file_index >= len(files):
                raise HTTPException(404, f"Audio file index {file_index} not found ({len(files)} files in directory)")
            return FileResponse(
                str(files[file_index]),
                media_type="audio/mpeg",
                headers={"Accept-Ranges": "bytes"},
            )
        elif local.exists():
            return FileResponse(
                str(local),
                media_type="audio/mpeg",
                headers={"Accept-Ranges": "bytes"},
            )

    # Fallback : proxy depuis ABS
    settings = get_settings()
    if not settings.audiobookshelf_token or not book.audio_item_id:
        raise HTTPException(404, "Audio file not accessible")

    # Récupère les infos de l'item pour trouver le bon fichier
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{settings.audiobookshelf_api}/api/items/{book.audio_item_id}",
            headers={"Authorization": f"Bearer {settings.audiobookshelf_token}"},
        )
        resp.raise_for_status()
        item = resp.json()

    audio_files = item.get("media", {}).get("audioFiles", [])
    if file_index >= len(audio_files):
        raise HTTPException(404, f"Audio file index {file_index} not found")

    filename = audio_files[file_index].get("metadata", {}).get("filename", "")
    audio_url = f"{settings.audiobookshelf_api}/api/items/{book.audio_item_id}/file/{filename}"

    # Streaming proxy avec support Range
    headers = {"Authorization": f"Bearer {settings.audiobookshelf_token}"}
    if "range" in request.headers:
        headers["Range"] = request.headers["range"]

    async def stream():
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("GET", audio_url, headers=headers) as r:
                async for chunk in r.aiter_bytes(chunk_size=65536):
                    yield chunk

    # Obtenir les headers de la réponse ABS pour les forwarder
    async with httpx.AsyncClient(timeout=10) as client:
        head_resp = await client.head(audio_url, headers=headers)

    status_code = 206 if "range" in request.headers else 200
    response_headers = {
        "Accept-Ranges": "bytes",
        "Content-Type": head_resp.headers.get("content-type", "audio/mpeg"),
    }
    if "content-length" in head_resp.headers:
        response_headers["Content-Length"] = head_resp.headers["content-length"]

    return StreamingResponse(stream(), status_code=status_code, headers=response_headers)


@router.get("/{book_id}/audio/lookup")
async def lookup_audio_timestamp(book_id: int, text: str, db: AsyncSession = Depends(get_db)):
    """
    Trouve les timestamps audio pour une phrase donnée.
    Retourne file_index, audio_start, audio_end ou null si non trouvé.
    """
    from difflib import SequenceMatcher

    result = await db.execute(
        select(Sentence)
        .join(Chapter)
        .where(Chapter.book_id == book_id)
        .where(Sentence.audio_start.isnot(None))
    )
    sentences = result.scalars().all()

    if not sentences:
        return {"found": False}

    query = text.strip().lower()
    best_ratio = 0.0
    best_sentence = None

    for s in sentences:
        ratio = SequenceMatcher(None, query, s.text.strip().lower()).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best_sentence = s

    if not best_sentence or best_ratio < 0.5:
        return {"found": False}

    return {
        "found": True,
        "file_index": best_sentence.audio_file_index or 0,
        "audio_start": best_sentence.audio_start,
        "audio_end": best_sentence.audio_end,
        "matched_ratio": round(best_ratio, 3),
    }


@router.get("/{book_id}/audio/context")
async def get_audio_context(book_id: int, text: str, db: AsyncSession = Depends(get_db)):
    """
    Retourne les timestamps audio pour une phrase + 1 phrase avant/après.
    """
    from difflib import SequenceMatcher

    result = await db.execute(
        select(Sentence)
        .join(Chapter)
        .where(Chapter.book_id == book_id)
        .where(Sentence.audio_start.isnot(None))
    )
    sentences = result.scalars().all()

    if not sentences:
        return {"found": False}

    query = text.strip().lower()
    best_ratio = 0.0
    best_sentence = None

    for s in sentences:
        ratio = SequenceMatcher(None, query, s.text.strip().lower()).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best_sentence = s

    if not best_sentence or best_ratio < 0.4:
        return {"found": False}

    prev_result = await db.execute(
        select(Sentence)
        .where(Sentence.chapter_id == best_sentence.chapter_id)
        .where(Sentence.order_index == best_sentence.order_index - 1)
    )
    prev_s = prev_result.scalar_one_or_none()

    next_result = await db.execute(
        select(Sentence)
        .where(Sentence.chapter_id == best_sentence.chapter_id)
        .where(Sentence.order_index == best_sentence.order_index + 1)
    )
    next_s = next_result.scalar_one_or_none()

    segments = []
    if prev_s and prev_s.audio_start is not None:
        segments.append({
            "role": "before",
            "text": prev_s.text,
            "audio_start": prev_s.audio_start,
            "audio_end": prev_s.audio_end,
            "file_index": prev_s.audio_file_index or 0,
        })
    segments.append({
        "role": "match",
        "text": best_sentence.text,
        "audio_start": best_sentence.audio_start,
        "audio_end": best_sentence.audio_end,
        "file_index": best_sentence.audio_file_index or 0,
    })
    if next_s and next_s.audio_start is not None:
        segments.append({
            "role": "after",
            "text": next_s.text,
            "audio_start": next_s.audio_start,
            "audio_end": next_s.audio_end,
            "file_index": next_s.audio_file_index or 0,
        })

    audio_start = segments[0]["audio_start"]
    audio_end = segments[-1]["audio_end"]
    file_index = segments[0]["file_index"]

    return {
        "found": True,
        "sentences": segments,
        "audio_start": audio_start,
        "audio_end": audio_end,
        "file_index": file_index,
    }


@router.get("/{book_id}/chapters")
async def list_chapters(book_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Chapter)
        .where(Chapter.book_id == book_id)
        .order_by(Chapter.order_index)
    )
    chapters = result.scalars().all()
    return [{"id": c.id, "title": c.title, "order_index": c.order_index} for c in chapters]


async def _parse_and_store(book_id: int, file_path: str):
    """Tâche de fond : parse le fichier et stocke tout en DB."""
    async with AsyncSessionLocal() as db:
        try:
            parser = EPUBParser(file_path)
            chapters_data = parser.get_chapters()

            book = await db.get(Book, book_id)
            if not book:
                return

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

        except Exception:
            await db.rollback()
            raise
