"""DeepEval suite session hook — emits the OUTPUT-JSON CONTRACT file (Milestone 12, ADR-0020).

Mirrors ``tests/conftest.py``: a ``pytest_sessionfinish`` reads the terminalreporter's pass/fail/skip
tallies and writes ``test-results/deepeval-output.json``. The TS fold script (``scripts/deepeval-
results.ts``) reads that file, builds a ``RunnerResult``, and calls ``foldRunner`` into the frozen
``test-results/summary.json``. When the suite is SKIPPED (no key / no eval group), every test is a
skip and the file still reports ``failed: 0`` with the per-metric breakdown empty — the fold script
treats an absent file as "suite skipped" and exits 0, so this is key-gated by design either way.

Shape (frozen envelope rides ``output``/``seeds``): ``{passed, failed, skipped, metrics, seed}`` —
``metrics`` is the per-metric ``{passed, failed}`` breakdown the tests populate via the shared
``_support.ACCUMULATOR``.
"""

from __future__ import annotations

import json
from pathlib import Path

from ._support import ACCUMULATOR, SEED

_OUTPUT = Path(__file__).resolve().parents[2] / "test-results" / "deepeval-output.json"


def pytest_sessionfinish(session, exitstatus) -> None:
    reporter = session.config.pluginmanager.get_plugin("terminalreporter")
    stats = getattr(reporter, "stats", {}) if reporter else {}
    payload = {
        "passed": len(stats.get("passed", [])),
        "failed": len(stats.get("failed", [])) + len(stats.get("error", [])),
        "skipped": len(stats.get("skipped", [])),
        "metrics": ACCUMULATOR.snapshot(),
        "seed": SEED,
    }
    _OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    _OUTPUT.write_text(json.dumps(payload, indent=2) + "\n")
