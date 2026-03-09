"""
Cache et génère les anecdotes sur le livre/auteur (sans spoil, avec source).
"""
from hermes_llm.client import OllamaClient
from hermes_llm.prompts.anecdotes import build_anecdotes_prompt


async def get_or_generate_anecdotes(book, db, ollama_client: OllamaClient) -> list[dict]:
    # Cache valide si c'est bien une liste de dicts avec 'text' et 'source'
    if book.anecdotes and isinstance(book.anecdotes, list) and book.anecdotes:
        if isinstance(book.anecdotes[0], dict) and "text" in book.anecdotes[0]:
            return book.anecdotes

    prompt = build_anecdotes_prompt(book.title, book.author or "Unknown")
    data = await ollama_client.generate_json(prompt, temperature=0.5)
    raw = data.get("anecdotes", [])

    # Normaliser : accepter strings (ancien format) ou dicts
    anecdotes = []
    for item in raw:
        if isinstance(item, dict) and "text" in item:
            anecdotes.append({"text": item["text"], "source": item.get("source", "")})
        elif isinstance(item, str):
            anecdotes.append({"text": item, "source": ""})

    if not anecdotes:
        anecdotes = [{"text": f'"{book.title}" was written by {book.author}.', "source": ""}]

    book.anecdotes = anecdotes
    await db.commit()
    return anecdotes
