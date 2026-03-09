"""
Parse un fichier EPUB ou KEPUB.
Dépendances : ebooklib, beautifulsoup4, spacy (modèle en_core_web_sm)
"""
import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup
import spacy
from pathlib import Path
import shutil
import tempfile

nlp = spacy.load("en_core_web_sm")


class EPUBParser:
    def __init__(self, file_path: str):
        self.path = Path(file_path)
        self._tmp_path = None

        # KEPUB : renommer temporairement en .epub pour ebooklib
        if self.path.suffix.lower() == ".kepub" or ".kepub.epub" in self.path.name:
            tmp = tempfile.NamedTemporaryFile(suffix=".epub", delete=False)
            shutil.copy2(str(self.path), tmp.name)
            self._tmp_path = tmp.name
            read_path = tmp.name
        else:
            read_path = str(self.path)

        self.book = epub.read_epub(read_path)

    def __del__(self):
        if self._tmp_path:
            try:
                Path(self._tmp_path).unlink(missing_ok=True)
            except Exception:
                pass

    def get_chapters(self) -> list[dict]:
        """Retourne une liste de chapitres avec leur texte brut."""
        chapters = []
        for i, item in enumerate(self.book.get_items_of_type(ebooklib.ITEM_DOCUMENT)):
            soup = BeautifulSoup(item.get_content(), "html.parser")
            text = soup.get_text(separator="\n", strip=True)
            if len(text) > 100:  # Ignorer les pages de titre vides
                h1 = soup.find("h1")
                h2 = soup.find("h2")
                title = h1.get_text(strip=True) if h1 else (h2.get_text(strip=True) if h2 else f"Chapter {i}")
                chapters.append({
                    "order_index": i,
                    "title": title,
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
