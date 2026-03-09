from typing import List, Dict, Any


def build_book_comprehension_prompt(
    cefr_level: str,
    book_summaries: List[Dict[str, Any]],
    n_questions: int = 8,
) -> str:
    summaries_text = "\n\n".join(
        f"Chapter {s['chapter_index']} — {s['title']}:\n{s['summary']}"
        for s in book_summaries
    )
    return f"""You are an English reading comprehension teacher creating {cefr_level}-level cross-chapter questions.

Book chapter summaries:
---
{summaries_text}
---

Generate exactly {n_questions} questions that test understanding ACROSS multiple chapters.
Target level: {cefr_level}

Question types to include:
- Character evolution across chapters (specific behavioral change, exact quote showing growth)
- Recurring motifs or symbols (precise first appearance and later echo)
- Timeline of events (exact order across chapters)
- Specific detail from a precise chapter (name, adjective used, dialogue fragment)
- Authorial style choice (irony, specific narrative technique)
- Cause and effect chain spanning multiple chapters

For each exercise, include:
- "source_passage": the specific fact or quote from the summary that supports the answer
- "source_chapter_index": the chapter index (integer) where the key information appears

Respond ONLY with valid JSON:
{{
  "exercises": [
    {{
      "subtype": "open_ended",
      "question": "...",
      "options": null,
      "correct_answer": "...",
      "source_passage": "specific fact or quote from chapter summary",
      "source_chapter_index": 0
    }},
    {{
      "subtype": "multiple_choice",
      "question": "...",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "correct_answer": "exact text of the correct option",
      "source_passage": "specific fact or quote from chapter summary",
      "source_chapter_index": 2
    }}
  ]
}}

Rules:
- Mix open_ended and multiple_choice
- Questions must require knowing multiple chapters to answer correctly
- source_passage must be concrete, not vague
- For {cefr_level}: {"test inference, irony, and stylistic awareness" if cefr_level in ("C1", "C2") else "keep questions clear and direct"}
- Return ONLY the JSON, no other text"""
