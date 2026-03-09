"""
Transcription d'un livre audio via faster-whisper.
Aligne les segments Whisper aux phrases existantes en DB.
Supporte les audiobooks mono-fichier et multi-fichiers (1 fichier par chapitre).

Pour les multi-fichiers, la correspondance fichier → chapitre est basée sur le
contenu (similarité textuelle), pas sur la position. Ainsi l'opening, l'outro
ou tout fichier non-narratif est ignoré automatiquement.
"""
import asyncio
import logging
from difflib import SequenceMatcher
from pathlib import Path

from hermes_worker.worker import app

log = logging.getLogger(__name__)

AUDIO_EXTS = {'.mp3', '.m4a', '.m4b', '.ogg', '.flac', '.wav', '.aac', '.opus'}


@app.task(bind=True, max_retries=1, default_retry_delay=60, time_limit=3600 * 8)
def transcribe_book(self, book_id: int):
    """Tâche longue durée : transcrit un audiobook et aligne les timestamps."""
    try:
        asyncio.run(_transcribe(book_id))
    except Exception as exc:
        log.exception(f"Transcription failed for book {book_id}")
        asyncio.run(_set_status(book_id, "failed"))
        raise self.retry(exc=exc)


# ─────────────────────────────────────────────────────────────────────────────

async def _set_status(book_id: int, status: str):
    from hermes_core.database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        from hermes_core.models.book import Book
        book = await db.get(Book, book_id)
        if book:
            book.transcription_status = status
            await db.commit()


def _load_whisper(settings):
    from faster_whisper import WhisperModel
    try:
        model = WhisperModel(settings.whisper_model, device="cuda", compute_type="float16")
        log.info("Whisper on GPU (float16)")
    except Exception:
        model = WhisperModel(settings.whisper_model, device="cpu", compute_type="int8")
        log.info("Whisper on CPU (int8 fallback)")
    return model


def _match_file_to_chapter(segments: list, sentences_by_chapter: dict) -> tuple[int | None, float]:
    """
    Trouve le chapitre EPUB dont le début ressemble le plus aux premiers
    segments du fichier audio. Retourne (chapter_id, best_ratio).
    Si aucun chapitre n'atteint le seuil minimum, retourne (None, ratio).

    On compare par paires segment × phrase (max sur les premiers N de chaque
    côté) pour éviter le bruit des silences/intros dans chaque fichier.
    """
    file_sample = segments[:40]   # ~2–4 premières minutes
    MIN_RATIO = 0.40

    best_ratio = 0.0
    best_chapter_id = None

    for chapter_id, sentences in sentences_by_chapter.items():
        ch_sample = sentences[:20]  # premières phrases du chapitre
        max_pair = 0.0
        for seg in file_sample:
            seg_text = seg.text.strip().lower()
            if not seg_text:
                continue
            for sent in ch_sample:
                sent_text = sent.text.strip().lower()
                if not sent_text:
                    continue
                r = SequenceMatcher(None, seg_text, sent_text).ratio()
                if r > max_pair:
                    max_pair = r
                    if max_pair >= 0.9:
                        break  # assez bon, pas besoin de continuer
            if max_pair >= 0.9:
                break

        if max_pair > best_ratio:
            best_ratio = max_pair
            best_chapter_id = chapter_id

    return (best_chapter_id if best_ratio >= MIN_RATIO else None), best_ratio


async def _transcribe(book_id: int):
    from hermes_core.database import AsyncSessionLocal
    from hermes_core.models.book import Book, Chapter, Sentence
    from hermes_core.config import get_settings
    from sqlalchemy import select

    settings = get_settings()

    async with AsyncSessionLocal() as db:
        book = await db.get(Book, book_id)
        if not book:
            log.error(f"Book {book_id} not found")
            return
        if not book.audio_path:
            log.error(f"Book {book_id} has no audio_path")
            return

        audio_path = Path(book.audio_path)

        if audio_path.is_dir():
            audio_files_list = sorted(
                f for f in audio_path.iterdir() if f.suffix.lower() in AUDIO_EXTS
            )
            if not audio_files_list:
                log.error(f"Book {book_id}: no audio files in {audio_path}")
                book.transcription_status = "failed"
                await db.commit()
                return
            log.info(f"Book {book_id}: multi-file mode — {len(audio_files_list)} files in {audio_path.name}/")
        elif audio_path.exists():
            audio_files_list = [audio_path]
            log.info(f"Book {book_id}: single-file mode — {audio_path.name}")
        else:
            log.error(f"Audio path not found: {audio_path}")
            book.transcription_status = "failed"
            await db.commit()
            return

        book.transcription_status = "running"
        await db.commit()

    # ── Charger le modèle Whisper ────────────────────────────────────────────
    try:
        model = _load_whisper(settings)
    except Exception:
        log.exception(f"Book {book_id}: Whisper model load failed")
        await _set_status(book_id, "failed")
        return

    # ── Charger les sentences depuis la DB ───────────────────────────────────
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Chapter).where(Chapter.book_id == book_id).order_by(Chapter.order_index)
        )
        chapters = result.scalars().all()

        sentences_by_chapter: dict[int, list] = {}
        all_sentences: list = []
        for chapter in chapters:
            result2 = await db.execute(
                select(Sentence)
                .where(Sentence.chapter_id == chapter.id)
                .order_by(Sentence.order_index)
            )
            sents = result2.scalars().all()
            sentences_by_chapter[chapter.id] = sents
            all_sentences.extend(sents)

        multi_file = len(audio_files_list) > 1

        if multi_file and all_sentences:
            # ── Mode multi-fichiers : correspondance par contenu ─────────────
            # Chaque fichier est transcrit puis matchés au chapitre EPUB
            # dont les phrases lui ressemblent le plus.
            # Les fichiers sans bon match (opening, outro…) sont ignorés.
            matched_chapters: set[int] = set()

            for file_idx, audio_file in enumerate(audio_files_list):
                log.info(f"Book {book_id}: transcribing file {file_idx} — {audio_file.name}")
                try:
                    segments_iter, info = model.transcribe(
                        str(audio_file),
                        language="en",
                        word_timestamps=True,
                        vad_filter=True,
                    )
                    segments = list(segments_iter)
                except Exception:
                    log.exception(f"Book {book_id}: Whisper failed on {audio_file.name}")
                    continue

                chapter_id, ratio = _match_file_to_chapter(segments, sentences_by_chapter)

                if chapter_id is None:
                    log.info(
                        f"  → no chapter match (best ratio={ratio:.2f}) — "
                        f"likely opening/outro, skipping"
                    )
                    continue

                if chapter_id in matched_chapters:
                    log.warning(
                        f"  → chapter {chapter_id} already matched by a previous file — skipping"
                    )
                    continue

                matched_chapters.add(chapter_id)
                chapter_sents = sentences_by_chapter[chapter_id]
                log.info(
                    f"  → matched chapter id={chapter_id} (ratio={ratio:.2f}), "
                    f"aligning {len(segments)} segments to {len(chapter_sents)} sentences"
                )
                _align_and_update(chapter_sents, segments, file_index=file_idx)

            unmatched = set(sentences_by_chapter) - matched_chapters
            if unmatched:
                log.warning(f"Book {book_id}: {len(unmatched)} chapter(s) had no matching audio file")

        elif all_sentences:
            # ── Mode mono-fichier avec sentences EPUB ───────────────────────
            try:
                segments_iter, info = model.transcribe(
                    str(audio_files_list[0]),
                    language="en",
                    word_timestamps=True,
                    vad_filter=True,
                )
                segments = list(segments_iter)
                log.info(f"Book {book_id}: {len(segments)} segments, {info.duration:.0f}s")
            except Exception:
                log.exception(f"Book {book_id}: Whisper failed")
                await _set_status(book_id, "failed")
                return

            _align_and_update(all_sentences, segments, file_index=0)

        else:
            # ── Pas de sentences EPUB : stocker les segments bruts ───────────
            try:
                segments_iter, info = model.transcribe(
                    str(audio_files_list[0]),
                    language="en",
                    word_timestamps=True,
                    vad_filter=True,
                )
                segments = list(segments_iter)
            except Exception:
                log.exception(f"Book {book_id}: Whisper failed")
                await _set_status(book_id, "failed")
                return

            await _store_raw_segments(book_id, segments, chapters, db)

        # Marquer comme transcrit
        book = await db.get(Book, book_id)
        book.transcribed = True
        book.transcription_status = "done"
        await db.commit()

    log.info(f"Book {book_id}: transcription complete")


def _align_and_update(sentences: list, segments: list, file_index: int = 0):
    """
    Aligne chaque phrase à son segment Whisper le plus proche par similarité textuelle.
    Utilise un pointeur glissant pour rester O(n) en pratique.
    """
    seg_idx = 0
    window = 8

    for sentence in sentences:
        sent_text = sentence.text.strip().lower()
        if not sent_text:
            continue

        best_ratio = 0.0
        best_start = None
        best_end = None
        best_pos = seg_idx

        lo = max(0, seg_idx - 2)
        hi = min(len(segments), seg_idx + window)

        for i in range(lo, hi):
            seg_text = segments[i].text.strip().lower()
            ratio = SequenceMatcher(None, sent_text, seg_text).ratio()
            if ratio > best_ratio:
                best_ratio = ratio
                best_start = segments[i].start
                best_end = segments[i].end
                best_pos = i

        if best_ratio >= 0.45:
            sentence.audio_start = round(best_start, 2)
            sentence.audio_end = round(best_end, 2)
            sentence.audio_file_index = file_index
            seg_idx = best_pos + 1

            best_seg = segments[best_pos]
            if hasattr(best_seg, "words") and best_seg.words:
                sentence.word_timestamps = [
                    {"word": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)}
                    for w in best_seg.words
                    if w.word.strip()
                ]


async def _store_raw_segments(book_id: int, segments: list, chapters: list, db):
    """
    Pas d'EPUB en DB : crée les Sentence rows directement depuis Whisper.
    """
    from hermes_core.models.book import Sentence, Book

    if not chapters:
        return

    total = len(segments)
    per_chapter = max(1, total // len(chapters))

    for ch_idx, chapter in enumerate(chapters):
        start = ch_idx * per_chapter
        end = start + per_chapter if ch_idx < len(chapters) - 1 else total
        chapter_segs = segments[start:end]

        for i, seg in enumerate(chapter_segs):
            s = Sentence(
                chapter_id=chapter.id,
                text=seg.text.strip(),
                order_index=i,
                audio_start=round(seg.start, 2),
                audio_end=round(seg.end, 2),
                audio_file_index=0,
            )
            db.add(s)

    book = await db.get(Book, book_id)
    if book:
        book.parsed = True
