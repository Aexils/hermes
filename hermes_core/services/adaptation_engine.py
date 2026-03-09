"""
Algorithme d'adaptation du score utilisateur.
new_score = old_score * 0.8 + success_rate * 0.2
"""
from typing import Dict

CEFR_LEVELS = [
    'A1', 'A1+',
    'A2-', 'A2', 'A2+',
    'B1-', 'B1', 'B1+',
    'B2-', 'B2', 'B2+',
    'C1-', 'C1', 'C1+',
    'C2',
]
MIN_CATEGORIES = 3
LEVEL_UP_AVG = 0.82    # Threshold to start streak towards next sub-level
LEVEL_DOWN_AVG = 0.25  # Immediate drop if avg falls below

GRAMMAR_CATEGORIES = [
    "past_simple", "present_perfect", "past_continuous",
    "present_simple", "conditionals", "passive_voice",
    "reported_speech", "articles", "prepositions",
]

MASTERED = 0.8   # Ne plus générer d'exercices pour cette catégorie
WEAK = 0.5       # Augmenter la probabilité dans le prochain batch
UNKNOWN = 0.0    # Catégorie jamais vue → priorité maximale


def _confidence_factor(time_ms: int | None, is_correct: bool) -> float:
    """
    Facteur de confiance basé sur le temps de réponse.

    Correct + rapide (<5s)  → 1.00  (maîtrisé)
    Correct + moyen (5-15s) → 0.90  (acquis mais pas automatique)
    Correct + lent  (>30s)  → 0.65  (fragile, besoin de révision)
    Faux + très rapide (<3s)→ 0.15  (devinette — pénalité réduite)
    Faux + lent             → 0.00  (vraiment non acquis)
    """
    if time_ms is None:
        return 1.0 if is_correct else 0.0
    s = time_ms / 1000
    if is_correct:
        if s < 5:   return 1.00
        if s < 15:  return 0.90
        if s < 30:  return 0.75
        return 0.65
    else:
        if s < 3:   return 0.15  # Devinette
        if s < 10:  return 0.05
        return 0.00


class AdaptationEngine:
    def update_grammar_score(
        self,
        current_scores: Dict[str, float],
        category: str,
        is_correct: bool,
        time_ms: int | None = None,
    ) -> Dict[str, float]:
        """Met à jour le score d'une catégorie grammaticale, pondéré par le temps."""
        old_score = current_scores.get(category, 0.5)
        success_rate = _confidence_factor(time_ms, is_correct)
        new_score = old_score * 0.8 + success_rate * 0.2
        return {**current_scores, category: round(new_score, 4)}

    def update_vocabulary_score(
        self,
        current_mastery: Dict[str, float],
        word: str,
        is_correct: bool,
        time_ms: int | None = None,
    ) -> Dict[str, float]:
        """Met à jour la maîtrise d'un mot de vocabulaire, pondérée par le temps."""
        old_score = current_mastery.get(word, 0.0)
        success_rate = _confidence_factor(time_ms, is_correct)
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
        # Exclure les catégories maîtrisées
        non_mastered = {cat: s for cat, s in all_scores.items() if s < MASTERED}
        return sorted(non_mastered, key=non_mastered.get)[:n]

    def get_recent_errors(
        self,
        error_log: list,
        exercise_type: str,
        n: int = 5,
    ) -> list[dict]:
        """Retourne les N dernières erreurs d'un type donné depuis error_log."""
        filtered = [e for e in (error_log or []) if e.get("type") == exercise_type]
        return filtered[-n:]

    def should_increase_difficulty(self, scores: Dict[str, float]) -> bool:
        avg = sum(scores.values()) / len(scores) if scores else 0
        return avg > 0.75

    def update_cefr_if_needed(self, user) -> str | None:
        """
        Monte le CEFR uniquement après 5 sessions consécutives au-dessus du seuil.
        Descend immédiatement si la moyenne chute sous LEVEL_DOWN_AVG.

        Calcul : 70 % grammaire + 30 % vocabulaire (top-20 mots).
        Le vocabulaire n'est pris en compte que si ≥ 5 mots ont été évalués.
        """
        grammar_scores = user.grammar_scores or {}
        if len(grammar_scores) < MIN_CATEGORIES:
            return None
        gram_avg = sum(grammar_scores.values()) / len(grammar_scores)

        vocab_mastery = user.vocabulary_mastery or {}
        if len(vocab_mastery) >= 5:
            top_vocab = sorted(vocab_mastery.values(), reverse=True)[:20]
            vocab_avg = sum(top_vocab) / len(top_vocab)
            avg = gram_avg * 0.7 + vocab_avg * 0.3
        else:
            avg = gram_avg
        try:
            idx = CEFR_LEVELS.index(user.cefr_level)
        except ValueError:
            idx = 2  # B1 par défaut

        streak = getattr(user, 'cefr_streak', 0) or 0

        if avg >= LEVEL_UP_AVG and idx < len(CEFR_LEVELS) - 1:
            new_streak = streak + 1
            user.cefr_streak = new_streak
            if new_streak >= 5:  # 5 sessions consécutives au-dessus du seuil
                user.cefr_streak = 0
                return CEFR_LEVELS[idx + 1]
        elif avg < LEVEL_DOWN_AVG and idx > 0:
            user.cefr_streak = 0
            return CEFR_LEVELS[idx - 1]
        else:
            user.cefr_streak = 0

        return None
