"""
Détection des fautes d'orthographe dans les réponses ouvertes.
Utilise pyspellchecker (dictionnaire offline, aucun appel réseau).
"""
import re
from spellchecker import SpellChecker

_checker = SpellChecker(language="en")

# Mots à ignorer (abréviations, conjugaisons contractées courantes)
_WHITELIST = {"i'm", "i've", "i'd", "i'll", "don't", "doesn't", "didn't",
              "can't", "won't", "isn't", "wasn't", "weren't", "hadn't",
              "haven't", "hasn't", "shouldn't", "wouldn't", "couldn't"}


def check_spelling(text: str) -> list[dict]:
    """
    Retourne une liste de { word, suggestion } pour chaque faute détectée.
    Ne signale pas les noms propres (mots commençant par une majuscule en
    milieu de phrase) ni les mots très courts (≤2 lettres).
    """
    # Tokenize : garder uniquement les mots alphabétiques
    tokens = re.findall(r"[A-Za-z']+", text)
    results = []
    seen = set()

    for token in tokens:
        lower = token.lower()
        if lower in seen or lower in _WHITELIST or len(lower) <= 2:
            continue
        # Ignorer les noms propres (majuscule non en début de phrase) — heuristique simple
        if token[0].isupper() and text.index(token) > 0:
            prev_char = text[text.index(token) - 1]
            if prev_char not in ".!?":
                seen.add(lower)
                continue

        unknown = _checker.unknown([lower])
        if unknown:
            suggestion = _checker.correction(lower) or lower
            if suggestion != lower:
                results.append({"word": token, "suggestion": suggestion})
            seen.add(lower)

    return results
