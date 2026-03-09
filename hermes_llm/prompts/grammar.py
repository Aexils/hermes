def build_grammar_prompt(
    cefr_level: str,
    grammar_categories: list[str],
    chapter_excerpt: str,
    n_exercises: int = 3,
    grammar_scores: dict | None = None,
    error_examples: list[dict] | None = None,
    learner_profile: str | None = None,
) -> str:
    categories_str = ", ".join(grammar_categories)
    first_cat = grammar_categories[0] if grammar_categories else "grammar"

    score_context = ""
    if grammar_scores:
        weak_items = [
            f"{cat}: {score:.2f}"
            for cat, score in grammar_scores.items()
            if cat in grammar_categories
        ]
        if weak_items:
            score_context = f"\nStudent weak areas (score/1.0): {', '.join(weak_items)}"

    error_context = ""
    if error_examples:
        lines = []
        for e in error_examples[:5]:
            lines.append(
                f'  - [{e.get("category", "?")}] '
                f'They wrote: "{e.get("user_answer", "")}" '
                f'→ correct: "{e.get("correct_answer", "")}"'
            )
        error_context = "\nRecent mistakes by this student (use these to target similar patterns):\n" + "\n".join(lines)

    profile_section = (
        f"\nLearner profile (use to personalize exercises):\n{learner_profile}"
        if learner_profile else ""
    )

    return f"""You are an English grammar teacher. Generate exactly {n_exercises} grammar exercises.

Student CEFR level: {cefr_level}
Target grammar: {categories_str}{score_context}{error_context}{profile_section}
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
      "grammar_category": "{first_cat}"
    }}
  ]
}}

Rules:
- fill_blank: use ___ for the blank
- error_correction: provide a sentence with one grammatical error
- sentence_transformation: ask to rewrite using a specific structure
- If recent mistakes are provided, generate at least one exercise targeting the same error pattern
- Difficulty must match CEFR level {cefr_level}
- Use vocabulary and context from the source text
- Return ONLY the JSON, no preamble"""
