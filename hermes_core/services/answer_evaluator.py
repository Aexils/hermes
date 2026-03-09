"""
Évaluateur LLM pour les réponses ouvertes (compréhension open_ended).
"""
from hermes_llm.client import OllamaClient
from hermes_core.config import get_settings


async def evaluate_open_ended(
    question: str,
    correct_answer: str,
    user_answer: str,
    cefr_level: str,
) -> dict:
    prompt = f"""You are an English teacher grading a comprehension answer.

Question: {question}
Reference answer: {correct_answer}
Student CEFR level: {cefr_level}
Student's answer: {user_answer}

A correct answer captures the main idea, even if phrased differently. Grammar errors are OK.
Respond ONLY with JSON: {{"is_correct": true/false, "feedback": "one encouraging sentence"}}"""

    settings = get_settings()
    ollama_client = OllamaClient(settings.ollama_host, settings.ollama_model)
    raw = await ollama_client.generate_json(prompt, temperature=0.1)
    return {
        "is_correct": bool(raw.get("is_correct", False)),
        "feedback": raw.get("feedback"),
    }
