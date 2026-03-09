"""
Prompt de résumé post-session.
Génère un feedback personnalisé à la fin de chaque session d'exercices.
"""


def build_session_summary_prompt(user, session_results: list[dict]) -> str:
    """
    session_results : liste de dicts avec keys :
      type, is_correct, time_ms (optional), user_answer, correct_answer, grammar_category, vocabulary_item
    """
    total = len(session_results)
    correct = sum(1 for r in session_results if r.get("is_correct"))
    accuracy = round((correct / total * 100) if total else 0)

    # Stats par type
    by_type: dict[str, dict] = {}
    for r in session_results:
        t = r.get("type", "unknown")
        if t not in by_type:
            by_type[t] = {"correct": 0, "total": 0}
        by_type[t]["total"] += 1
        if r.get("is_correct"):
            by_type[t]["correct"] += 1

    by_type_str = "\n".join(
        f"  - {t}: {d['correct']}/{d['total']} correct"
        for t, d in by_type.items()
    )

    # Erreurs commises
    errors = [r for r in session_results if not r.get("is_correct")]
    errors_str = (
        "\n".join(
            f'  - Wrote "{r.get("user_answer", "")}" instead of "{r.get("correct_answer", "")}"'
            f' ({r.get("grammar_category") or r.get("vocabulary_item") or r.get("type", "")})'
            for r in errors[:6]
        )
        if errors else "  None — perfect session!"
    )

    # Temps moyen si disponible
    times = [r["time_ms"] for r in session_results if r.get("time_ms")]
    avg_time_str = (
        f"Average response time: {round(sum(times) / len(times) / 1000, 1)}s"
        if times else ""
    )

    profile_section = (
        f"\nSTUDENT PROFILE:\n{user.learner_profile}"
        if user.learner_profile else ""
    )

    return f"""You are an encouraging English teacher giving post-session feedback.
A student at {user.cefr_level} level just completed a practice session.
{profile_section}

SESSION RESULTS: {correct}/{total} correct ({accuracy}%)
BY TYPE:
{by_type_str}
{avg_time_str}

MISTAKES MADE:
{errors_str}

Write a SHORT (2-3 sentences) personalized feedback message:
1. Acknowledge their actual performance specifically (avoid generic "great job!")
2. Highlight ONE concrete strength shown in this session
3. Identify ONE specific area to focus on next time

Rules:
- Be warm and encouraging but honest
- Reference their actual mistakes or successes
- No markdown, plain conversational English
- If accuracy ≥ 90%: celebrate enthusiastically
- If accuracy < 50%: be extra encouraging, frame it as a learning opportunity

Also provide ONE grammar or vocabulary category to focus on next (the weakest area from today).

Return ONLY valid JSON:
{{
  "summary": "Your 2-3 sentence feedback here",
  "focus_area": "one_category_name"
}}"""
