"""pytest configuration for the red-team suite (ADR-0020).

Mirrors ``tests/conftest.py``: a ``pytest_sessionfinish`` hook writes a machine-readable summary that
the matching TS fold scripts (``scripts/deepteam-results.ts`` / ``scripts/pyrit-results.ts``) read and
fold into the frozen ``test-results/summary.json`` (Commitment 14 — every runner emits structured
output).

OUTPUT-JSON CONTRACT (ADR-0020): a suite that actually RAN (key present, eval group installed) writes
``test-results/<name>-output.json`` with shape
``{passed, failed, skipped, metrics: {…}, seed}`` for ``<name> ∈ {deepteam, pyrit}``. We detect which
suite ran from the markers on the COLLECTED items and write only the file(s) for the marker(s) that
ran — so a deepteam-only invocation does not leave a stale pyrit file and vice versa. When the suite
is skipped entirely (no key / no group), nothing is written and the fold script exits 0 by design.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

_RESULTS_DIR = Path(__file__).resolve().parents[2] / "test-results"

# marker name -> output filename + the seed key the run reports under.
_SUITES = {
    "deepteam": "deepteam-output.json",
    "pyrit": "pyrit-output.json",
}

# Deterministic attack seed: the red-team attack synthesis is seeded so a run is reproducible (the
# determinism discipline applied to the adversary, ADR-0017). Surfaced into summary.json via the fold
# script's ``seeds`` field.
REDTEAM_SEED = 0


def _markers_for(item: object) -> set[str]:
    return {m.name for m in item.iter_markers()} if hasattr(item, "iter_markers") else set()


def pytest_sessionfinish(session, exitstatus) -> None:
    reporter = session.config.pluginmanager.get_plugin("terminalreporter")
    stats = getattr(reporter, "stats", {}) if reporter else {}

    # Which suites collected at least one item this session — only those get an output file, so a
    # marker-scoped invocation (`-m deepteam`) never overwrites the other suite's prior report.
    items = getattr(session, "items", []) or []
    ran: set[str] = set()
    for item in items:
        ran |= _markers_for(item) & set(_SUITES)
    if not ran:
        return

    # Per-suite pass/fail/skip from the collected report stats. terminalreporter holds TestReport
    # objects (not Items), so attribute each by its nodeid — the file names (test_deepteam_* /
    # test_pyrit_*) make the suite unambiguous. Only count the `call` phase (and setup-phase skips, the
    # phase importorskip/skipif fire in) so a passing test's setup/teardown reports are not double-counted.
    tally: dict[str, Counter[str]] = {name: Counter() for name in ran}
    for outcome in ("passed", "failed", "error", "skipped"):
        for report in stats.get(outcome, []):
            phase = getattr(report, "when", "call")
            if outcome == "skipped":
                if phase not in ("setup", "call"):
                    continue
            elif phase != "call":
                continue
            bucket = "failed" if outcome in ("failed", "error") else outcome
            for name in _suite_from_report(report, ran):
                tally[name][bucket] += 1

    _RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    for name in ran:
        counts = tally[name]
        summary = {
            "passed": counts.get("passed", 0),
            "failed": counts.get("failed", 0),
            "skipped": counts.get("skipped", 0),
            "metrics": {
                "suite": name,
                "owasp_llm": "LLM01:prompt-injection",
                "headline_target": "prompt-injection-in-post-body",
            },
            "seed": REDTEAM_SEED,
        }
        (_RESULTS_DIR / _SUITES[name]).write_text(json.dumps(summary, indent=2) + "\n")


def _suite_from_report(report: object, ran: set[str]) -> set[str]:
    """Best-effort marker attribution for a TestReport: match the suite name against the file/nodeid.

    The red-team files are named ``test_deepteam_*`` / ``test_pyrit_*``, so the suite is unambiguous
    from the report's ``nodeid`` without needing the live Item — keeps the hook robust across pytest
    versions where ``stats`` holds reports rather than items.
    """
    nodeid = str(getattr(report, "nodeid", ""))
    return {name for name in ran if name in nodeid}
