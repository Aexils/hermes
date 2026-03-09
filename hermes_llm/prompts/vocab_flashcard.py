import random


def build_vocab_flashcard_prompt(
    cefr_level: str,
    book_sentences: list[str],
    n_exercises: int = 15,
) -> str:
    # Sample diverse sentences, not just the first N
    sample = random.sample(book_sentences, min(50, len(book_sentences)))
    sentences_block = "\n".join(f"- {s.strip()}" for s in sample if s.strip())

    return f"""You are an English vocabulary coach. Create {n_exercises} vocabulary flashcard exercises using sentences taken directly from a student's book.

Student CEFR level: {cefr_level}

Book sentences (pick the most interesting vocabulary for this level):
{sentences_block}

Rules:
- Each exercise is built around ONE interesting word OR the meaning of the whole sentence
- "source_passage" MUST be copied verbatim from the list — it is the student's actual book sentence
- Skip trivial words (the, is, a, said, went) — target words the student is likely to not know perfectly
- Aim for vocabulary slightly above the student's level to push them
- Use this mix of subtypes:
  • context_clue — "In this passage, what does '[word]' mean?" → 4 MC options
  • fill_blank — the sentence with the word replaced by ___, student types the missing word
  • usage_match — "Which definition best fits '[word]' as used here?" → 4 MC options
  • sentence_meaning — "What is this sentence saying?" → 4 MC paraphrases of the whole sentence
    (IELTS-style: tests global comprehension, no single word targeted)
    Distractors must be plausible but subtly wrong (miss tone, implication or a key detail)

Respond ONLY with valid JSON:
{{
  "exercises": [
    {{
      "subtype": "context_clue" | "fill_blank" | "usage_match" | "sentence_meaning",
      "question": "...",
      "options": null or ["A) ...", "B) ...", "C) ...", "D) ..."],
      "correct_answer": "...",
      "vocabulary_item": "the_target_word" or null,
      "source_passage": "exact verbatim sentence from the list above"
    }}
  ]
}}

- fill_blank: question is the sentence with ___ instead of the word; correct_answer is the word itself; options is null
- context_clue / usage_match / sentence_meaning: options required, correct_answer is the full option string (e.g. "A) Short-lived")
- sentence_meaning: aim for ~30% of exercises; pick sentences rich enough to have nuance; vocabulary_item is null
- Vary difficulty across all subtypes
- Return ONLY the JSON, no prose before or after"""
