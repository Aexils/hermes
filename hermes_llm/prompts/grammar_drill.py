def build_grammar_drill_prompt(
    cefr_level: str,
    category: str,
    n_exercises: int,
    book_context: str,
    error_examples: list[dict] | None = None,
) -> str:
    """
    Prompt pour un drill intensif sur UNE seule catégorie grammaticale.
    Les exercices sont ancrés dans le contexte du livre pour rester immersifs.
    """
    category_display = category.replace("_", " ").title()

    error_context = ""
    if error_examples:
        lines = [
            f'  - They wrote: "{e.get("user_answer", "")}" → correct: "{e.get("correct_answer", "")}"'
            for e in error_examples[:4]
        ]
        error_context = f"\nRecent student mistakes on {category_display}:\n" + "\n".join(lines)
        error_context += "\nTarget the exact same confusion patterns in your exercises."

    return f"""You are an English grammar drill teacher. Generate exactly {n_exercises} exercises focused EXCLUSIVELY on: {category_display}

Student CEFR level: {cefr_level}{error_context}

Book context (use vocabulary and characters from this text):
---
{book_context[:2000]}
---

Generate {n_exercises} varied exercises. Use ALL of these subtypes (distribute evenly):
- fill_blank: sentence with ___ where the {category_display} form goes
- error_correction: sentence containing one {category_display} error to fix
- sentence_transformation: rewrite using {category_display} structure
- multiple_choice: 4 options testing {category_display} distinctions

JSON format:
{{
  "exercises": [
    {{
      "subtype": "fill_blank" | "error_correction" | "sentence_transformation" | "multiple_choice",
      "question": "...",
      "options": null or ["A) ...", "B) ...", "C) ...", "D) ..."],
      "correct_answer": "...",
      "grammar_category": "{category}"
    }}
  ]
}}

Rules:
- Every exercise must specifically test {category_display} — nothing else
- Use names, places, and events from the book context
- Difficulty must match {cefr_level}
- For error_correction: clearly indicate "Correct this sentence:"
- For sentence_transformation: clearly indicate what structure to use
- Return ONLY the JSON"""
