def build_anecdotes_prompt(book_title: str, author: str, n: int = 6) -> str:
    return f"""You are a literary historian. Generate exactly {n} verifiable anecdotes about the book "{book_title}" by {author}.

Rules — STRICT:
- Focus ONLY on: the author's life, writing conditions, how the book was created, its publication history, literary reception, cultural impact, biographical trivia
- NO plot summaries, NO character descriptions, NO story events — nothing that could spoil the reading
- Each anecdote: a single sentence, max 30 words, factually accurate
- For each anecdote, provide a real, specific source (Wikipedia article title, a known biography, a publisher's note, a newspaper, etc.)
- If you are not certain of a fact, do not include it

Respond ONLY with valid JSON:
{{
  "anecdotes": [
    {{
      "text": "Factual anecdote sentence.",
      "source": "Source name (e.g. 'Wikipedia — {author}', 'The Guardian, 1998', 'Publisher biography')"
    }}
  ]
}}

Return ONLY the JSON."""
