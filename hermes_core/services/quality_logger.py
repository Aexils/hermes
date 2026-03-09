"""
Tracks comprehension question quality across sessions.

- Writes to question_quality_log.json (volume-mounted, persists across restarts)
- Exposes recent failures to inject as negative examples in generation prompts
- Logs failure-rate stats to compare baseline vs. recent performance
"""
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger(__name__)

LOG_PATH = Path("/app/hermes_core/question_quality_log.json")


class QuestionQualityLogger:
    def __init__(self, path: Path = LOG_PATH):
        self.path = path
        self._entries: list[dict] = self._load()

    def _load(self) -> list[dict]:
        if self.path.exists():
            try:
                return json.loads(self.path.read_text(encoding="utf-8"))
            except Exception as exc:
                log.warning("quality_logger: could not load %s: %s", self.path, exc)
        return []

    def _save(self) -> None:
        try:
            self.path.write_text(
                json.dumps(self._entries, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception as exc:
            log.error("quality_logger: could not save %s: %s", self.path, exc)

    def record(
        self,
        question: str,
        source_passage: str,
        passed: bool,
        reason: str = "",
    ) -> None:
        """Log one question's validation result."""
        self._entries.append(
            {
                "ts": datetime.now(timezone.utc).isoformat(),
                "question": question,
                "source_passage": source_passage,
                "passed": passed,
                "reason": reason,
            }
        )
        self._save()

    def recent_failures(self, n: int = 5) -> list[dict]:
        """Return the n most recent failed questions (for negative-example injection)."""
        return [e for e in self._entries if not e["passed"]][-n:]

    def log_stats(self) -> None:
        """Log failure-rate comparison: baseline (first 20) vs. recent (last 20)."""
        total = len(self._entries)
        if not total:
            log.info("[quality] No questions logged yet.")
            return

        def _rate(entries: list[dict]) -> str:
            if not entries:
                return "n/a"
            failed = sum(1 for e in entries if not e["passed"])
            pct = round(100 * failed / len(entries))
            return f"{failed}/{len(entries)} ({pct}%)"

        baseline = self._entries[:20]
        recent = self._entries[-20:]
        log.info(
            "[quality] total=%d | failure baseline(first 20)=%s | failure recent(last 20)=%s",
            total,
            _rate(baseline),
            _rate(recent),
        )
