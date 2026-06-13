"""Pre-flight cost guard for the eval / red-team run (ADR-0017 cost-guard, retained by ADR-0020).

Estimates the token cost of EVERY LLM lane (gold/DeepEval, DeepTeam single-turn, PyRIT multi-turn)
BEFORE any OpenAI call and fails CI if the total exceeds ``MODERATOR_EVAL_BUDGET_TOKENS``. The estimate
+ vendored prices (``evals/cost-model.json``) also yield a dollar figure. A coarse chars/4 heuristic is
enough — the point is a hard ceiling so a ballooning run can never run up an unbounded bill, and (unlike
the original gold-set-only estimate) the red-team lanes that were the real uncapped risk are now in it.

Run: ``pnpm --filter @qaroom/moderator-agent eval:cost``.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from .config import load_settings
from .cost import estimate_lanes, load_cost_model

_EVALS = Path(__file__).resolve().parents[2] / "evals"


def _gold_inputs() -> tuple[int, list[str]]:
    messages = json.loads((_EVALS / "moderation.prompt.json").read_text())
    system_chars = sum(len(message["content"]) for message in messages)
    gold = json.loads((_EVALS / "golden" / "gold.json").read_text())
    posts = [c.get("post", "") for c in gold.get("cases", []) if c.get("status") == "gold"]
    return system_chars, posts


def main() -> None:
    settings = load_settings()
    budget = settings.moderator_eval_budget_tokens
    model = settings.moderator_model
    cost_model = load_cost_model()
    system_chars, posts = _gold_inputs()
    lanes = estimate_lanes(model, system_chars, posts, cost_model)

    total_tokens = sum(lane.tokens for lane in lanes)
    total_usd = round(sum(lane.usd for lane in lanes), 4)
    for lane in lanes:
        print(f"  {lane.name:<16} {lane.tokens:>8} tokens  ~${lane.usd:.4f}")
    print(
        f"estimated eval cost: {total_tokens} tokens ~${total_usd:.4f} "
        f"(budget {budget} tokens, model {model})"
    )
    if total_tokens > budget:
        print("ERROR: estimated eval cost exceeds MODERATOR_EVAL_BUDGET_TOKENS")
        sys.exit(1)
    print("✓ within budget")


if __name__ == "__main__":
    main()
