"""Cost-effectiveness comparison: run the SME-gold set through the REAL moderator (in-memory stores
seeded from the versioned corpus, live LLM + embedder) for several models and report disposition
agreement. The point: find the cheapest model that still does the job. The architecture is built for
exactly this — `init_chat_model` makes the model a one-line swap, and the gold set is the bar.

Agreement uses the repo's own taxonomy: SME `allow` -> agent `approve`, SME `flag` -> agent `remove`.
`escalate_to_human` is the abstain path (safe, not a decisive match) and is tallied separately, so
"decisive accuracy" = matches / (matches + misses), excluding abstentions.

Run:  uv run python evals/model_compare.py [model_id ...]
Spends real OpenAI tokens (a few cents per model over 26 cases).
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

from moderator_agent.config import Settings
from moderator_agent.eval_support import build_live_workflow, gold_event
from moderator_agent.workflow.graph import ModerationWorkflow

GOLD = Path(__file__).resolve().parent / "golden" / "gold.json"
EXPECT = {"allow": "approve", "flag": "remove"}


def _build(model: str) -> ModerationWorkflow:
    settings = Settings(moderator_model=model)
    # Same wiring as every other eval target (the shared builder); only the model id varies here.
    workflow, _ = build_live_workflow(settings)
    return workflow


async def _run_model(model: str, cases: list[dict]) -> tuple[int, int, int]:
    wf = _build(model)
    match = abstain = miss = 0
    for case in cases:
        decision = await wf.run(gold_event(case))
        disposition = decision.disposition if decision else "escalate_to_human"
        want = EXPECT.get(case["gold_verdict"])
        if disposition == "escalate_to_human":
            abstain += 1
        elif want is not None and disposition == want:
            match += 1
        else:
            miss += 1
    return match, abstain, miss


def main() -> None:
    models = sys.argv[1:] or [
        "openai:gpt-5.5-2026-04-23",
        "openai:gpt-5-mini",
        "openai:gpt-5-mini",
    ]
    cases = [c for c in json.loads(GOLD.read_text())["cases"] if c.get("status") == "gold"]
    print(f"{len(cases)} gold cases\n")
    print(f"{'model':<30}{'match':>7}{'abstain':>9}{'miss':>6}{'decisive-acc':>14}")
    for model in models:
        match, abstain, miss = asyncio.run(_run_model(model, cases))
        decisive = match + miss
        acc = f"{match / decisive * 100:.0f}%" if decisive else "n/a"
        print(f"{model:<30}{match:>7}{abstain:>9}{miss:>6}{acc:>14}")


if __name__ == "__main__":
    main()
