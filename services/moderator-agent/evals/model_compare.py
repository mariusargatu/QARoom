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
from moderator_agent.determinism import seeded_trio
from moderator_agent.lamport import LamportGate
from moderator_agent.llm import LangChainEmbedder, LangChainLlmClient
from moderator_agent.persistence.memory import (
    InMemoryDecisionStore,
    InMemoryKnowledgeStore,
    InMemoryPolicyCorpusStore,
)
from moderator_agent.persistence.rules_seed import load_corpus_dir
from moderator_agent.rerank import LlmReranker
from moderator_agent.schemas import PostCreatedEvent
from moderator_agent.wiring import RULES_DIR
from moderator_agent.workflow.graph import ModerationWorkflow

COMMUNITY = "comm_" + "0" * 26
GOLD = Path(__file__).resolve().parent / "golden" / "gold.json"
EXPECT = {"allow": "approve", "flag": "remove"}


def _build(model: str) -> ModerationWorkflow:
    settings = Settings(moderator_model=model)
    clock, ids, _ = seeded_trio()
    corpus = InMemoryPolicyCorpusStore()
    corpus.set_entries(COMMUNITY, load_corpus_dir(RULES_DIR).get(COMMUNITY, []))
    return ModerationWorkflow(
        llm=LangChainLlmClient(settings),
        embedder=LangChainEmbedder(settings),
        reranker=LlmReranker(settings),
        knowledge=InMemoryKnowledgeStore(),
        corpus=corpus,
        decisions=InMemoryDecisionStore(),
        clock=clock,
        ids=ids,
        lamport=LamportGate(ids),
        settings=settings,
    )


async def _run_model(model: str, cases: list[dict]) -> tuple[int, int, int]:
    wf = _build(model)
    match = abstain = miss = 0
    for case in cases:
        suffix = case["id"].replace("cand_", "").rjust(26, "0")
        event = PostCreatedEvent(
            event_id="evt_" + suffix,
            post_id="post_" + suffix,
            community_id=COMMUNITY,
            author_id="user_" + "0" * 26,
            title="moderation review",
            body=case["post"],
            created_at="2026-06-05T00:00:00.000Z",
        )
        decision = await wf.run(event)
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
