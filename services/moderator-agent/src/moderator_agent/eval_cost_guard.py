"""Pre-flight cost guard for the eval / red-team run (ADR-0017 cost-guard, retained by ADR-0020).

Estimates the token cost of the SME-gold eval set BEFORE any OpenAI call and fails CI if it exceeds
``MODERATOR_EVAL_BUDGET_TOKENS``. A coarse chars/4 heuristic is enough — the point is a hard ceiling
so a ballooning DeepEval / DeepTeam run can never run up an unbounded bill (the guarantee survives the
Promptfoo→DeepEval swap). Run: ``pnpm --filter @qaroom/moderator-agent eval:cost``.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from .config import load_settings

_EVALS = Path(__file__).resolve().parents[2] / "evals"
_COMPLETION_TOKENS_PER_CASE = 60  # a verdict is small and bounded
# A citation-bearing RAG eval makes more than one judged call per case (faithfulness + agentic +
# G-Eval metrics each invoke the judge); scale the estimate so the ceiling reflects the real surface.
_JUDGED_CALLS_PER_CASE = 4


def estimate_tokens() -> int:
    messages = json.loads((_EVALS / "moderation.prompt.json").read_text())
    system_chars = sum(len(message["content"]) for message in messages)
    # The eval cases are the SME-gold set (gold.json), now consumed directly by DeepEval (ADR-0020).
    gold = json.loads((_EVALS / "golden" / "gold.json").read_text())
    cases = [c for c in gold.get("cases", []) if c.get("status") == "gold"]
    total = 0
    for case in cases:
        post = case.get("post", "")
        prompt_tokens = (system_chars + len(post)) // 4
        total += (prompt_tokens + _COMPLETION_TOKENS_PER_CASE) * _JUDGED_CALLS_PER_CASE
    return total


def main() -> None:
    budget = load_settings().moderator_eval_budget_tokens
    estimate = estimate_tokens()
    print(f"estimated eval cost: {estimate} tokens (budget {budget})")
    if estimate > budget:
        print("ERROR: estimated eval cost exceeds MODERATOR_EVAL_BUDGET_TOKENS")
        sys.exit(1)
    print("✓ within budget")


if __name__ == "__main__":
    main()
