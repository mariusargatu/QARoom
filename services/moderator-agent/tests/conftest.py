"""pytest configuration. Async mode is set in pyproject (``asyncio_mode = "auto"``).

A session hook writes a machine-readable summary the ``moderator:results`` script folds into
``test-results/summary.json`` (Commitment 14 — every runner emits structured output).
"""

from __future__ import annotations

import json
from pathlib import Path

_SUMMARY = Path(__file__).resolve().parents[1] / "test-results" / "pytest-summary.json"


def pytest_sessionfinish(session, exitstatus) -> None:
    reporter = session.config.pluginmanager.get_plugin("terminalreporter")
    stats = getattr(reporter, "stats", {}) if reporter else {}
    counts = {
        "passed": len(stats.get("passed", [])),
        "failed": len(stats.get("failed", [])) + len(stats.get("error", [])),
        "skipped": len(stats.get("skipped", [])),
    }
    _SUMMARY.parent.mkdir(parents=True, exist_ok=True)
    _SUMMARY.write_text(json.dumps(counts, indent=2) + "\n")
