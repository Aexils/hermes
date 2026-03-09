"""
Prompt de génération du profil apprenant.
Analysé à partir de error_log + grammar_scores + vocabulary_mastery.
Résultat : texte en langage naturel injecté dans chaque prompt d'exercice.
"""


def build_learner_profile_prompt(user) -> str:
    grammar_scores = user.grammar_scores or {}
    vocab_mastery = user.vocabulary_mastery or {}
    error_log = user.error_log or []

    # Catégories grammaticales par niveau
    weak_grammar = sorted(
        [(k, v) for k, v in grammar_scores.items() if v < 0.55],
        key=lambda x: x[1]
    )[:5]
    strong_grammar = sorted(
        [(k, v) for k, v in grammar_scores.items() if v >= 0.80],
        key=lambda x: -x[1]
    )[:3]

    # Vocabulaire faible
    weak_vocab = sorted(
        [(k, v) for k, v in vocab_mastery.items() if v < 0.4],
        key=lambda x: x[1]
    )[:12]

    # Patterns d'erreur récents (30 dernières)
    error_counts: dict[str, int] = {}
    for e in error_log[-30:]:
        cat = e.get("category") or e.get("type") or "unknown"
        error_counts[cat] = error_counts.get(cat, 0) + 1
    top_errors = sorted(error_counts.items(), key=lambda x: -x[1])[:5]

    # Exemples d'erreurs récentes pour analyse qualitative
    recent_errors = error_log[-8:]

    weak_gram_str = (
        ", ".join(f"{k} ({v:.2f})" for k, v in weak_grammar)
        if weak_grammar else "none identified yet"
    )
    strong_gram_str = (
        ", ".join(f"{k} ({v:.2f})" for k, v in strong_grammar)
        if strong_grammar else "none yet"
    )
    weak_vocab_str = (
        ", ".join(w for w, _ in weak_vocab)
        if weak_vocab else "none identified yet"
    )
    error_str = (
        ", ".join(f"{cat} ({n}x)" for cat, n in top_errors)
        if top_errors else "no errors recorded yet"
    )
    examples_str = (
        "\n".join(
            f'  - Wrote "{e.get("user_answer", "")}" instead of "{e.get("correct_answer", "")}"'
            f' (type: {e.get("type", "?")})'
            for e in recent_errors
        )
        if recent_errors else "  No mistakes yet"
    )

    return f"""You are an expert English language pedagogy analyst.
Analyze this student's learning data and generate a concise learner profile.

STUDENT LEVEL: {user.cefr_level}
TOTAL VOCABULARY TRACKED: {len(vocab_mastery)} words

GRAMMAR SCORES (0.0 = unknown, 1.0 = mastered):
  Weak areas: {weak_gram_str}
  Strong areas: {strong_gram_str}

VOCABULARY GAPS: {weak_vocab_str}

MOST FREQUENT ERROR CATEGORIES: {error_str}

RECENT MISTAKES (for qualitative analysis):
{examples_str}

Write a learner profile of 3-4 sentences in second person ("You tend to...").
It should describe:
1. The student's main grammar weakness pattern (be specific about the type of errors)
2. Vocabulary gaps or tendencies
3. One strength to build on
4. One concrete recommendation for exercises

This profile will be injected into AI exercise generation prompts.
It must be specific, pedagogically actionable, and grounded in the data above.

Return ONLY valid JSON:
{{"profile": "Your profile text here (2-4 sentences, plain text, no markdown)"}}"""
