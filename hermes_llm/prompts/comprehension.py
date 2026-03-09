def build_comprehension_prompt(
    cefr_level: str,
    chapter_text: str,
    n_questions: int = 5,
    chapter_title: str = "",
    negative_examples: list[dict] | None = None,
) -> str:
    title_line = f"Chapter: {chapter_title}\n" if chapter_title else ""

    negative_section = ""
    if negative_examples:
        lines = [
            f"- Question: '{ex['question']}' | Reason it was rejected: '{ex['reason']}'"
            for ex in negative_examples
            if ex.get("question") and ex.get("reason")
        ]
        if lines:
            negative_section = (
                "\nEXAMPLES OF BAD QUESTIONS TO AVOID (rejected by quality checker):\n"
                + "\n".join(lines)
                + "\n"
            )

    return f"""You are an English reading comprehension teacher creating {cefr_level}-level questions.

{title_line}Chapter text:
---
{chapter_text[:3000]}
---

Generate exactly {n_questions} exercises. Mix open_ended and multiple_choice subtypes.
Target level: {cefr_level}
{negative_section}
CRITICAL RULES — read carefully before generating:
1. For EACH exercise, write the question FIRST, then pick the answer FROM THE TEXT, then copy the passage that CONTAINS that answer.
2. The correct_answer must answer THAT specific question — not any other question.
3. For open_ended: correct_answer is a short phrase (1-6 words) taken verbatim from the text.
4. For multiple_choice: correct_answer must be EXACTLY one of the option strings (copy-paste it).
5. source_passage must be a verbatim 1-3 sentence quote from the text that contains the correct_answer word(s).
6. NEVER reuse the same correct_answer for two different questions.
7. UNIQUENESS (mandatory): Before writing each question, ask yourself: "Does the passage mention exactly ONE entity/fact that answers this?" If the passage lists or implies multiple equally valid answers (e.g. "each house has produced great wizards" → ALL houses qualify), you MUST NOT ask "which one". Instead, ask about the count, the list as a whole, or a specific attribute that distinguishes only one item. A question where any wrong option could also be correct is INVALID.

Complete one exercise fully before starting the next one.

Respond ONLY with valid JSON:
{{
  "exercises": [
    {{
      "subtype": "open_ended",
      "question": "What is the name of the street where the Dursleys live?",
      "options": null,
      "correct_answer": "Privet Drive",
      "source_passage": "Mr. and Mrs. Dursley, of number four, Privet Drive, were proud to say that they were perfectly normal."
    }},
    {{
      "subtype": "multiple_choice",
      "question": "What color is the Dursleys' car?",
      "options": ["A) silver", "B) dust-colored", "C) black", "D) blue"],
      "correct_answer": "B) dust-colored",
      "source_passage": "He reversed out of number four's drive and set off. His car was dust-colored."
    }}
  ]
}}

- All answers must be explicitly in the text
- For {cefr_level}: {"use precise vocabulary and test subtle distinctions" if cefr_level in ("C1", "C2") else "keep questions clear and direct"}
- Return ONLY the JSON, no other text"""
