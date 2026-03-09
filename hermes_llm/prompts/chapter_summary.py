def build_chapter_summary_prompt(chapter_text: str, chapter_title: str = "") -> str:
    title_line = f"Chapter: {chapter_title}\n" if chapter_title else ""
    return f"""You are creating a dense fact sheet for an English comprehension exercise.

{title_line}Chapter text:
---
{chapter_text[:4000]}
---

Write a summary of AT MOST 150 words. This is a FACT SHEET, not a narrative.

Include:
- Character names and exact adjectives used to describe them
- Verbatim dialogue fragments (short, memorable lines)
- Specific locations mentioned
- Exact order of key events
- Precise details (numbers, colors, objects, dates if present)
- Any surprising or distinctive moments

DO NOT write flowing prose. Write dense, factual bullet-point-style content.
Format: short declarative sentences, one fact per sentence.

Respond ONLY with the summary text, no JSON, no titles, no preamble."""
