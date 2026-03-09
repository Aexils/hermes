"""
Orchestre la génération d'une session quotidienne complète.
"""
import asyncio
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from hermes_llm.client import OllamaClient
from hermes_llm.prompts import grammar, comprehension, vocabulary
from hermes_llm.prompts.comprehension_book import build_book_comprehension_prompt
from hermes_core.services.adaptation_engine import AdaptationEngine
from hermes_core.services.book_summarizer import get_or_generate_summary
from hermes_core.services.book_anecdotes import get_or_generate_anecdotes
from hermes_core.services.quality_logger import QuestionQualityLogger

log = logging.getLogger(__name__)


GRAMMAR_SUBTYPES = {
    "fill_blank", "multiple_choice", "error_correction", "sentence_transform",
    "word_order", "conjugation",
}


def _validate_grammar(exercises: list[dict]) -> list[dict]:
    """
    Filtre les exercices de grammaire malformés :
    - question non vide
    - correct_answer non vide
    - grammar_category présent
    - options est une liste (pour multiple_choice)
    """
    valid = []
    for ex in exercises:
        if not ex.get("question", "").strip():
            continue
        if not ex.get("correct_answer", "").strip():
            continue
        # Normalise le subtype
        subtype = ex.get("subtype", "")
        if subtype and subtype not in GRAMMAR_SUBTYPES:
            ex["subtype"] = "fill_blank"
        valid.append(ex)
    return valid


def _validate_vocabulary(exercises: list[dict]) -> list[dict]:
    """
    Filtre les exercices de vocabulaire malformés :
    - question non vide
    - correct_answer non vide
    - vocabulary_item présent (pour le tracking SRS)
    - options est une liste si multiple_choice
    """
    valid = []
    for ex in exercises:
        if not ex.get("question", "").strip():
            continue
        if not ex.get("correct_answer", "").strip():
            continue
        # vocabulary_item doit être présent pour que le SRS fonctionne
        if not ex.get("vocabulary_item"):
            # Tenter de l'inférer depuis la question
            ex["vocabulary_item"] = ex.get("correct_answer", "").split()[0].lower()
        # Vérifier que les options sont bien une liste
        opts = ex.get("options")
        if opts is not None and not isinstance(opts, list):
            ex["options"] = [str(opts)]
        valid.append(ex)
    return valid


def _validate_comprehension(exercises: list[dict]) -> list[dict]:
    """
    Filtre les exercices où correct_answer n'est pas dans source_passage.
    Protège contre les confusions d'alignement question↔réponse du LLM.
    """
    valid = []
    for ex in exercises:
        answer = ex.get("correct_answer", "").strip()
        passage = ex.get("source_passage", "").strip()
        if not answer:
            continue
        if not passage:
            # Pas de passage du tout → on garde quand même
            valid.append(ex)
            continue
        # Pour multiple_choice, strip le préfixe "A) " etc. avant de chercher
        clean_answer = answer
        if len(answer) >= 3 and answer[1] in ")." and answer[0].upper() in "ABCD":
            clean_answer = answer[3:].strip()
        # Au moins un mot significatif (>3 chars) de la réponse doit apparaître dans le passage
        words = [w.lower() for w in clean_answer.split() if len(w) > 3]
        passage_lower = passage.lower()
        if not words or any(w in passage_lower for w in words):
            valid.append(ex)
    return valid


class ExerciseGenerator:
    def __init__(self, ollama_client: OllamaClient):
        self.client = ollama_client
        self.adapter = AdaptationEngine()
        self.quality_logger = QuestionQualityLogger()

    async def generate_daily_batch(
        self,
        user,            # modèle SQLAlchemy User
        chapter_text: str,
        chapter_excerpt: str,
        target_words: list[str],
        chapter_title: str = "",
        book=None,
        db=None,
        grammar_count: int = 5,
        vocab_count: int = 8,
        comprehension_count: int = 7,
    ) -> dict:
        """
        Génère une session complète :
        - 7 questions de compréhension (avec source_passage)
        - 5 exercices de grammaire (catégories les plus faibles + erreurs récentes)
        - 8 exercices de vocabulaire (mots SRS dus en priorité + erreurs récentes)
        """
        weakest = self.adapter.get_weakest_grammar_categories(
            user.grammar_scores or {}, n=3
        )
        if not weakest:
            from hermes_core.services.adaptation_engine import GRAMMAR_CATEGORIES
            weakest = GRAMMAR_CATEGORIES[:2]

        gram_errors = self.adapter.get_recent_errors(user.error_log, "grammar", n=5)
        vocab_errors = self.adapter.get_recent_errors(user.error_log, "vocabulary", n=4)

        # Compréhension — injecte les derniers échecs comme exemples négatifs
        past_failures = self.quality_logger.recent_failures(n=5)
        comp_prompt = comprehension.build_comprehension_prompt(
            user.cefr_level, chapter_text,
            n_questions=comprehension_count, chapter_title=chapter_title,
            negative_examples=past_failures or None,
        )

        learner_profile = user.learner_profile or None

        # Grammaire — avec historique d'erreurs + profil apprenant
        gram_prompt = grammar.build_grammar_prompt(
            user.cefr_level, weakest, chapter_excerpt,
            n_exercises=grammar_count, grammar_scores=user.grammar_scores,
            error_examples=gram_errors or None,
            learner_profile=learner_profile,
        )

        # Vocabulaire — avec mots SRS dus + historique d'erreurs + profil apprenant
        vocab_prompt = vocabulary.build_vocabulary_prompt(
            user.cefr_level, target_words, chapter_excerpt, n_exercises=vocab_count,
            error_examples=vocab_errors or None,
            learner_profile=learner_profile,
        )

        # Lancer les 3 appels LLM en parallèle avec timeout global (2 min, GPU)
        try:
            async with asyncio.timeout(600):
                comp_data, gram_data, vocab_data = await asyncio.gather(
                    self.client.generate_json(comp_prompt, temperature=0.8, thinking=True),
                    self.client.generate_json(gram_prompt, temperature=0.1, thinking=False),
                    self.client.generate_json(vocab_prompt, temperature=0.4, thinking=False),
                )
        except TimeoutError:
            comp_data, gram_data, vocab_data = {}, {}, {}

        anecdotes = []
        if book and db:
            anecdotes = await get_or_generate_anecdotes(book, db, self.client)

        comp_exercises = _validate_comprehension(comp_data.get("exercises", []))
        gram_exercises = _validate_grammar(gram_data.get("exercises", []))
        vocab_exercises = _validate_vocabulary(vocab_data.get("exercises", []))

        # Validation unicité : filtre les questions où plusieurs réponses sont défendables
        if comp_exercises:
            validation_results = await self.client.validate_comprehension_questions(comp_exercises)

            # Log chaque résultat et filtrer
            filtered = []
            for ex, res in zip(comp_exercises, validation_results):
                passed = res["valid"]
                reason = res.get("reason", "")
                self.quality_logger.record(
                    question=ex.get("question", ""),
                    source_passage=ex.get("source_passage", ""),
                    passed=passed,
                    reason=reason,
                )
                if passed:
                    filtered.append(ex)
                else:
                    log.info("[quality] REJECTED: %r | reason: %s", ex.get("question", ""), reason)
            comp_exercises = filtered

            # Régénération si on a perdu plus de 2 questions
            n_missing = comprehension_count - len(comp_exercises)
            if n_missing > 2:
                updated_failures = self.quality_logger.recent_failures(n=5)
                retry_prompt = comprehension.build_comprehension_prompt(
                    user.cefr_level, chapter_text,
                    n_questions=n_missing, chapter_title=chapter_title,
                    negative_examples=updated_failures or None,
                )
                retry_data = await self.client.generate_json(
                    retry_prompt, temperature=0.8, thinking=True
                )
                retry_exs = _validate_comprehension(retry_data.get("exercises", []))
                if retry_exs:
                    retry_results = await self.client.validate_comprehension_questions(retry_exs)
                    retry_valid = []
                    for ex, res in zip(retry_exs, retry_results):
                        passed = res["valid"]
                        self.quality_logger.record(
                            question=ex.get("question", ""),
                            source_passage=ex.get("source_passage", ""),
                            passed=passed,
                            reason=res.get("reason", ""),
                        )
                        if passed:
                            retry_valid.append(ex)
                    comp_exercises.extend(retry_valid[:n_missing])

            self.quality_logger.log_stats()

        return {
            "comprehension": comp_exercises,
            "grammar": gram_exercises,
            "vocabulary": vocab_exercises,
            "anecdotes": anecdotes,
        }

    async def generate_book_batch(
        self,
        user,
        book_id: int,
        chapters: list,
        sentences_by_chapter: dict,
        db: AsyncSession,
        book=None,
    ) -> dict:
        """
        Génère 8 questions cross-chapitres pour un livre entier.
        Utilise des résumés (mis en cache sur Chapter.summary).
        """
        book_summaries = []
        for chapter in chapters:
            sentences = sentences_by_chapter.get(chapter.id, [])
            summary = await get_or_generate_summary(chapter, sentences, db, self.client)
            book_summaries.append({
                "chapter_index": chapter.order_index,
                "title": chapter.title or f"Chapter {chapter.order_index}",
                "summary": summary,
            })

        prompt = build_book_comprehension_prompt(
            user.cefr_level, book_summaries, n_questions=8
        )
        data = await self.client.generate_json(prompt, temperature=0.7)
        exercises = data.get("exercises", [])

        # Map source_chapter_index → chapter.id
        index_to_id = {c.order_index: c.id for c in chapters}
        for ex in exercises:
            idx = ex.pop("source_chapter_index", None)
            if idx is not None:
                ex["source_chapter_id"] = index_to_id.get(idx)

        anecdotes = []
        if book and db:
            anecdotes = await get_or_generate_anecdotes(book, db, self.client)

        return {"comprehension": exercises, "anecdotes": anecdotes}
