"""
Client Ollama pour la génération d'exercices.
Deux modes : déterministe (grammaire) et créatif (compréhension).
"""
import httpx
import json
import logging
import re

log = logging.getLogger(__name__)


def _extract_json(raw: str) -> dict:
    """
    Extraction robuste de JSON : tente d'abord un parse direct,
    puis parcourt les accolades pour extraire l'objet le plus externe.
    Gère les modèles qui émettent du texte avant/après le JSON.
    """
    raw = raw.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # Parcours des accolades pour trouver l'objet JSON externe
    depth = 0
    start = -1
    for i, ch in enumerate(raw):
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start != -1:
                try:
                    return json.loads(raw[start : i + 1])
                except json.JSONDecodeError:
                    start = -1  # Essayer le prochain objet
    return {}


class OllamaClient:
    def __init__(self, host: str, model: str):
        self.host = host.rstrip("/")
        self.model = model

    async def generate(
        self,
        prompt: str,
        temperature: float = 0.7,
        max_tokens: int = 4096,
    ) -> str:
        async with httpx.AsyncClient(timeout=300.0) as client:
            response = await client.post(
                f"{self.host}/api/generate",
                json={
                    "model": self.model,
                    "prompt": prompt,
                    "temperature": temperature,
                    "num_predict": max_tokens,
                    "stream": False,
                },
            )
            response.raise_for_status()
            return response.json()["response"]

    async def generate_deterministic(self, prompt: str) -> str:
        """Mode déterministe pour les exercices de grammaire."""
        return await self.generate(prompt, temperature=0.1)

    async def generate_creative(self, prompt: str) -> str:
        """Mode créatif pour les questions de compréhension."""
        return await self.generate(prompt, temperature=0.8)

    async def validate_comprehension_questions(
        self, exercises: list[dict]
    ) -> list[dict]:
        """
        Vérifie que chaque question a exactement UNE bonne réponse défendable par son source_passage.
        Retourne une liste de dicts {"valid": bool, "reason": str}.
        """
        if not exercises:
            return []

        items = [
            {
                "id": i,
                "question": ex.get("question", ""),
                "correct_answer": ex.get("correct_answer", ""),
                "options": ex.get("options"),
                "source_passage": ex.get("source_passage", ""),
            }
            for i, ex in enumerate(exercises)
        ]

        prompt = (
            "You are a strict exam quality checker. For each question below, determine if it has "
            "EXACTLY ONE correct answer based solely on its source_passage.\n\n"
            "Mark as invalid if:\n"
            "- The passage mentions multiple items that ALL match the question (e.g. passage says "
            "'each house produced great wizards' → asking 'which house' is invalid)\n"
            "- Any wrong option could also be correct based on the passage\n"
            "- The correct answer is an arbitrary pick among equally valid choices\n\n"
            "Mark as valid if:\n"
            "- Only ONE answer is supported by the passage\n"
            "- Wrong options are clearly contradicted or absent from the passage\n\n"
            f"Questions to check:\n{json.dumps(items, ensure_ascii=False)}\n\n"
            "Return ONLY JSON: "
            '{"results": [{"id": 0, "valid": true, "reason": ""}, '
            '{"id": 1, "valid": false, "reason": "passage mentions all houses, not just one"}, ...]}'
        )

        data = await self.generate_json(prompt, temperature=0.0)
        results = data.get("results", [])
        result_map: dict[int, dict] = {
            r["id"]: r
            for r in results
            if isinstance(r, dict) and "id" in r
        }
        return [
            {
                "valid": bool(result_map[i].get("valid", True)) if i in result_map else True,
                "reason": result_map[i].get("reason", "") if i in result_map else "",
            }
            for i in range(len(exercises))
        ]

    async def generate_json(
        self,
        prompt: str,
        temperature: float = 0.7,
        max_retries: int = 3,
        thinking: bool = False,
    ) -> dict:
        """
        Génère et parse du JSON avec retry automatique.
        thinking=False : ajoute /no_think pour Qwen3 → plus rapide, évite les tokens inutiles.
        thinking=True  : laisse le modèle raisonner (utile pour compréhension complexe).
        """
        suffix = "" if thinking else " /no_think"
        current_prompt = prompt + suffix
        for attempt in range(max_retries):
            if attempt > 0:
                current_prompt = prompt + suffix + "\n\nIMPORTANT: Return ONLY valid JSON. No text before or after."
            try:
                async with httpx.AsyncClient(timeout=300.0) as client:
                    response = await client.post(
                        f"{self.host}/api/generate",
                        json={
                            "model": self.model,
                            "prompt": current_prompt,
                            "temperature": temperature,
                            "num_predict": 512,
                            "stream": False,
                            "format": "json",
                        },
                    )
                    response.raise_for_status()
                    raw = response.json()["response"]
                # Strip <think>…</think> blocks (Qwen3, DeepSeek-R1, etc.)
                raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
                data = _extract_json(raw)
                if data:
                    return data
                log.warning("generate_json attempt %d: empty JSON extracted", attempt + 1)
            except (ValueError, json.JSONDecodeError) as exc:
                log.warning("generate_json attempt %d: JSON parse error: %s", attempt + 1, exc)
        log.error("generate_json: all %d attempts failed, returning {}", max_retries)
        return {}
