"""Cost model for the LLM lanes: vendored prices + pre-flight token estimate -> dollars.

The single source of the numbers is ``evals/cost-model.json`` (prices + estimate heuristics), read by
both this module and ``scripts/render-cost.ts`` so the README cost block and the Python guard/ledger
cannot diverge. Prices are vendored (deterministic, offline, reproducible) rather than live-fetched:
there is no official OpenAI pricing API, the pinned model id has no public price, and a network fetch
would break determinism + offline CI. Refresh real-model prices from LiteLLM's public map by hand.

The estimate is honest about its limits: DeepEval/DeepTeam/PyRIT call OpenAI through their own clients
and report no token counts, so this is a pre-flight ESTIMATE, not a measured actual. ``CostAccumulator``
captures the one path we DO instrument (runtime moderation through ``llm.py``) so a run can record
measured usage alongside the estimate.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

_EVALS = Path(__file__).resolve().parents[2] / "evals"
_COST_MODEL = _EVALS / "cost-model.json"


@dataclass(frozen=True)
class LaneCost:
    """One lane's pre-flight estimate."""

    name: str
    tokens: int
    usd: float


def load_cost_model(path: Path = _COST_MODEL) -> dict:
    return json.loads(path.read_text())


def usd_for_tokens(model: str, input_tokens: int, output_tokens: int, prices: dict) -> float:
    """Dollars for a token split at the vendored per-1M rates. Unknown model -> 0.0 (never raises;
    a missing price is a telemetry gap, not a run failure — mirrors llm.py's usage-metadata stance)."""
    rate = prices.get(model)
    if rate is None:
        return 0.0
    return (input_tokens * rate["input_per_1m"] + output_tokens * rate["output_per_1m"]) / 1_000_000


def _round(usd: float) -> float:
    return round(usd, 6)


def estimate_lanes(
    model: str, system_chars: int, gold_posts: list[str], cost_model: dict
) -> list[LaneCost]:
    """Pre-flight token + dollar estimate per eval lane, from the cost-model heuristics. The gold/DeepEval
    lane is the one the legacy guard sized; deepteam and pyrit are added so the ceiling actually bounds
    the red-team lanes the old estimate missed (PyRIT multi-turn was the one unbounded cost)."""
    e = cost_model["estimate"]
    prices = cost_model["prices"]

    # gold / DeepEval: each case feeds the system prompt + post, judged by N metric calls.
    gold_input = sum((system_chars + len(post)) // 4 for post in gold_posts)
    gold_output = len(gold_posts) * e["gold_completion_tokens_per_case"]
    gold_tokens = (gold_input + gold_output) * e["judged_calls_per_case"]
    gold_usd = usd_for_tokens(
        model,
        gold_input * e["judged_calls_per_case"],
        gold_output * e["judged_calls_per_case"],
        prices,
    )

    # deepteam (single-turn OWASP): synthesized attacks x calls/attack.
    dt_calls = e["deepteam_attacks"] * e["deepteam_calls_per_attack"]
    dt_tokens = dt_calls * e["deepteam_tokens_per_call"]
    dt_usd = usd_for_tokens(model, dt_tokens // 2, dt_tokens - dt_tokens // 2, prices)

    # pyrit (multi-turn): objectives x turns x calls/turn — the token-heavy lane.
    pr_calls = e["pyrit_objectives"] * e["pyrit_turns"] * e["pyrit_calls_per_turn"]
    pr_tokens = pr_calls * e["pyrit_tokens_per_call"]
    pr_usd = usd_for_tokens(model, pr_tokens // 2, pr_tokens - pr_tokens // 2, prices)

    return [
        LaneCost("gold-deepeval", gold_tokens, _round(gold_usd)),
        LaneCost("deepteam-owasp", dt_tokens, _round(dt_usd)),
        LaneCost("pyrit-nightly", pr_tokens, _round(pr_usd)),
    ]


@dataclass
class CostAccumulator:
    """Accumulates MEASURED usage from calls through our instrumented client (runtime moderation),
    so a run can record real tokens next to the estimate. Third-party eval harnesses bypass this."""

    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    calls: int = 0

    def add(self, input_tokens: int | None, output_tokens: int | None) -> None:
        self.input_tokens += input_tokens or 0
        self.output_tokens += output_tokens or 0
        self.calls += 1

    def usd(self, prices: dict) -> float:
        return _round(usd_for_tokens(self.model, self.input_tokens, self.output_tokens, prices))
