"""Pre-flight cost guard for the Promptfoo eval (ADR-0017 cost-guard decision).

Estimates the token cost of the golden-set run BEFORE any OpenAI call and fails CI if it exceeds
``MODERATOR_EVAL_BUDGET_TOKENS``. A coarse chars/4 heuristic is enough — the point is a hard ceiling
so a ballooning eval can never run up an unbounded bill. Run: ``pnpm --filter @qaroom/moderator-agent eval:cost``.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import yaml

from .config import load_settings

_EVALS = Path(__file__).resolve().parents[2] / "evals"
_COMPLETION_TOKENS_PER_CASE = 60  # a verdict is small and bounded


def estimate_tokens() -> int:
    config = yaml.safe_load((_EVALS / "promptfooconfig.yaml").read_text())
    messages = json.loads((_EVALS / "moderation.prompt.json").read_text())
    system_chars = sum(len(message["content"]) for message in messages)
    providers = config.get("providers", []) or [None]
    # The eval cases are the SME-gold set (generated), not the inline config (ADR-0017).
    tests = yaml.safe_load((_EVALS / "golden" / "promptfoo-tests.yaml").read_text()) or []
    total = 0
    for test in tests:
        post = test.get("vars", {}).get("post", "")
        prompt_tokens = (system_chars + len(post)) // 4
        total += prompt_tokens + _COMPLETION_TOKENS_PER_CASE
    return total * len(providers)


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
