def build_vocabulary_prompt(
    cefr_level: str,
    target_words: list[str],
    chapter_excerpt: str,
    n_exercises: int = 5,
    error_examples: list[dict] | None = None,
    learner_profile: str | None = None,
) -> str:
    words_str = ", ".join(target_words[:10])

    error_context = ""
    if error_examples:
        lines = []
        for e in error_examples[:4]:
            lines.append(
                f'  - [{e.get("category", "?")}] '
                f'They wrote: "{e.get("user_answer", "")}" '
                f'→ correct: "{e.get("correct_answer", "")}"'
            )
        error_context = "\nRecent vocabulary mistakes (prioritize similar words in new exercises):\n" + "\n".join(lines)

    profile_section = (
        f"\nLearner profile (use to personalize exercises):\n{learner_profile}"
        if learner_profile else ""
    )

    return f"""You are an English vocabulary teacher. Generate {n_exercises} vocabulary exercises.

Student CEFR level: {cefr_level}
Target vocabulary: {words_str}{error_context}{profile_section}
Source text:
---
{chapter_excerpt[:1000]}
---

Respond ONLY with valid JSON:
{{
  "exercises": [
    {{
      "subtype": "cloze" | "definition_matching" | "synonym_selection",
      "question": "...",
      "options": null or ["A) ...", "B) ...", "C) ...", "D) ..."],
      "correct_answer": "...",
      "vocabulary_item": "word_being_tested"
    }}
  ]
}}

- cloze: sentence from text with word removed, use ___
- definition_matching: give definition, ask for the word (MCQ)
- synonym_selection: give word, choose correct synonym (MCQ)
- If recent mistakes are provided, include at least one exercise on those words
- Return ONLY the JSON"""
