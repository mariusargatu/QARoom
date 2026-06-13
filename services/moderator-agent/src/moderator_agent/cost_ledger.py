"""Write the per-run LLM cost ledger after the eval lanes run (the "populate the data after each run"
artifact). Records, for this run: the pre-flight estimate per lane, the dollar total at vendored prices,
the budget headroom, the model, and a timestamp — so a key-gated skip is no longer indistinguishable
from "ran green last week" (the freshness signal the test-strategy review flagged as missing).

Lands in ``test-results/cost-ledger.json`` (gitignored, like the rest of test-results/, and uploaded as
a CI artifact). It is SEPARATE from the frozen summary.json — that schema is do-not-touch. The README
cost block (scripts/render-cost.ts) carries the STABLE estimate (no timestamp) so it stays byte-gated;
the volatile per-run record lives here.

The numbers are an honest ESTIMATE: DeepEval/DeepTeam/PyRIT report no token usage, so only a run that
flushes a CostAccumulator (runtime moderation through llm.py) contributes a 'measured' figure. Run:
``pnpm --filter @qaroom/moderator-agent cost:ledger -- <iso-timestamp> [commit]``.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from .config import load_settings
from .cost import estimate_lanes, load_cost_model
from .eval_cost_guard import _gold_inputs

_LEDGER = Path(__file__).resolve().parents[2] / "test-results" / "cost-ledger.json"


def build_ledger(generated_at: str, commit: str | None) -> dict:
    """Pure: assemble the ledger dict. Timestamp + commit are injected (no new Date() / no impure
    clock read — the determinism rule holds even for build tooling)."""
    settings = load_settings()
    model = settings.moderator_model
    budget = settings.moderator_eval_budget_tokens
    cost_model = load_cost_model()
    system_chars, posts = _gold_inputs()
    lanes = estimate_lanes(model, system_chars, posts, cost_model)
    total_tokens = sum(lane.tokens for lane in lanes)
    total_usd = round(sum(lane.usd for lane in lanes), 6)
    return {
        "generated_at": generated_at,
        "commit": commit,
        "model": model,
        "prices_source": cost_model["_meta"]["prices_source"],
        "basis": "estimate",
        "budget_tokens": budget,
        "within_budget": total_tokens <= budget,
        "lanes": [{"name": l.name, "tokens": l.tokens, "usd": l.usd, "basis": "estimate"} for l in lanes],
        "total_tokens": total_tokens,
        "total_usd": total_usd,
    }


def main() -> None:
    # Timestamp is passed in (the determinism rule bans new Date() in non-test code; the caller
    # supplies it, e.g. the CI step or `date -u +%FT%TZ`). Fall back to a sentinel when omitted.
    generated_at = sys.argv[1] if len(sys.argv) > 1 else "unstamped"
    commit = sys.argv[2] if len(sys.argv) > 2 else None
    ledger = build_ledger(generated_at, commit)
    _LEDGER.parent.mkdir(parents=True, exist_ok=True)
    _LEDGER.write_text(json.dumps(ledger, indent=2) + "\n")
    print(
        f"cost ledger -> {_LEDGER.name}: {ledger['total_tokens']} tokens "
        f"~${ledger['total_usd']:.4f} at {generated_at} (model {ledger['model']})"
    )


if __name__ == "__main__":
    main()
