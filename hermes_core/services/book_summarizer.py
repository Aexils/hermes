"""
Cache and generate chapter summaries for whole-book comprehension mode.
"""
from hermes_llm.client import OllamaClient
from hermes_llm.prompts.chapter_summary import build_chapter_summary_prompt


async def get_or_generate_summary(chapter, sentences, db, ollama_client: OllamaClient) -> str:
    if chapter.summary:
        return chapter.summary

    chapter_text = " ".join(s.text for s in sentences)
    prompt = build_chapter_summary_prompt(chapter_text, chapter.title or "")
    summary_raw = await ollama_client.generate(prompt, temperature=0.1)
    chapter.summary = summary_raw[:1000]
    await db.commit()
    return chapter.summary
