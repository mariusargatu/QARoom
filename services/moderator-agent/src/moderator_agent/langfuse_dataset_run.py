"""Run the agent over the seeded golden dataset and record it as a Langfuse dataset RUN — the
reproducible, API-driven way to fill the Evaluations view (Langfuse's online LLM-judge evaluator has
no creation API, so it can't be seeded; this can).

Each gold case is reviewed; the run's trace is linked to the dataset item and scored ``exact_match``
(agent disposition vs the SME-expected one). The agent also emits its usual per-decision scores +
session, so the run's traces are fully annotated.

Key-gated (needs OPENAI_API_KEY + the corpus DB + Langfuse). Run in-cluster:
  kubectl exec deploy/moderator-agent -n qaroom -- \
    uv run --no-dev python -m moderator_agent.langfuse_dataset_run
"""

from __future__ import annotations

import asyncio
import json
import sys

from opentelemetry import trace as _otel_trace

from . import telemetry
from .config import load_settings
from .determinism import production_trio
from .eval_support import EVAL_COMMUNITY, build_live_workflow
from .langfuse_integration import LangfuseClient
from .langfuse_seed import GOLD_PATH, VERDICT_TO_DISPOSITION, seed_langfuse
from .persistence.corpus import PgPolicyCorpusStore
from .persistence.db import open_pool
from .schemas import PostCreatedEvent, iso_z

# The community the policy corpus is seeded under (rules/<community_id>.yaml) — retrieval is per-tenant.
_CORPUS_COMMUNITY = EVAL_COMMUNITY


async def main() -> int:
    settings = load_settings()
    langfuse = LangfuseClient(settings)
    if not langfuse.enabled:
        print("Langfuse not configured (LANGFUSE_HOST + keys) — nothing to run.")
        return 1

    telemetry.setup_telemetry(settings)  # so OpenInference traces export to Langfuse
    await seed_langfuse(langfuse, settings)  # ensure the dataset exists before linking run items

    clock, ids, _ = production_trio()
    pool = await open_pool(settings.database_url)
    # Shared eval-target wiring: production clock/ids (so events + traces share them) over the Pg corpus
    # already seeded in Postgres (no in-memory seeding), with the Langfuse observability sink attached.
    workflow, _ = build_live_workflow(
        settings,
        community_id=_CORPUS_COMMUNITY,
        clock=clock,
        ids=ids,
        corpus=PgPolicyCorpusStore(pool),
        langfuse=langfuse,
    )

    cases = json.loads(GOLD_PATH.read_text(encoding="utf-8")).get("cases", [])
    run_name = f"golden-{iso_z(clock.now())}"
    tracer = _otel_trace.get_tracer("moderator.dataset-run")
    correct = 0
    for case in cases:
        expected = VERDICT_TO_DISPOSITION.get(case.get("gold_verdict"), "escalate_to_human")
        event = PostCreatedEvent(
            event_id=ids.next("evt"),
            post_id=ids.next("post"),
            community_id=_CORPUS_COMMUNITY,
            author_id=ids.next("user"),
            title=f"golden {case['id']}",
            body=case["post"],
            created_at=iso_z(clock.now()),
        )
        with tracer.start_as_current_span("dataset-run-item") as span:
            decision = await workflow.run(event)
            trace_id = format(span.get_span_context().trace_id, "032x")
        disposition = decision.disposition if decision is not None else "escalate_to_human"
        match = disposition == expected
        correct += 1 if match else 0
        await langfuse.create_dataset_run_item(
            run_name=run_name, dataset_item_id=case["id"], trace_id=trace_id
        )
        await langfuse.create_score(
            trace_id=trace_id,
            name="exact_match",
            value=1 if match else 0,
            data_type="BOOLEAN",
            comment=f"expected={expected} got={disposition}",
        )

    _otel_trace.get_tracer_provider().force_flush()  # type: ignore[attr-defined]
    await pool.close()
    total = len(cases)
    print(f"dataset run '{run_name}': {correct}/{total} exact-match → Langfuse Evaluations")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
