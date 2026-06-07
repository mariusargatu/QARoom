"""Shared scaffolding for the DeepEval suite (Milestone 12, ADR-0020).

Builds the REAL in-process RAG target — the LangGraph moderator wired with the live
``LangChainLlmClient`` / ``LangChainEmbedder`` over in-memory stores seeded from the versioned policy
corpus — and turns each SME-gold post into an ``LLMTestCase``-shaped record (``input`` /
``actual_output`` / ``retrieval_context`` + the disposition and grounded ``cited_rules``).

IMPORT DISCIPLINE: this module must import cleanly WITHOUT the ``eval`` group, because the suite's
``conftest`` imports ``ACCUMULATOR`` / ``SEED`` from here at collection time (before any test's
``importorskip`` runs). So ``deepeval`` is imported lazily inside the case-building functions, never at
module top-level — the accumulator, ``SEED``, and gold loading work key-gate-off; the live target only
materialises when a (key-gated) test actually calls ``build_workflow`` / ``run_case``.

The cost ceiling is the existing pre-flight guard in ``moderator_agent.eval_cost_guard``
(``pnpm … eval:cost``) — not duplicated here; this module only RUNS cases the guard has budgeted.

A module-level ``ACCUMULATOR`` collects per-metric pass/fail tallies the conftest folds into the
``deepeval-output.json`` OUTPUT-JSON CONTRACT. Tests append via ``record_metric``; the conftest reads
its immutable ``snapshot``. ``SEED`` is fixed so the report's ``seed`` field is deterministic (the LLM
itself is the only stochastic dependency).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

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
from moderator_agent.schemas import ModerationDecision, PolicyEntry, PostCreatedEvent
from moderator_agent.wiring import RULES_DIR
from moderator_agent.workflow.graph import ModerationWorkflow

# NOTE: ``deepeval`` is NOT imported at module top-level on purpose — see the module docstring's IMPORT
# DISCIPLINE note. ``LLMTestCase`` is built lazily in ``_llm_test_case`` so the conftest can import
# ``ACCUMULATOR`` / ``SEED`` from here at collection time without the key-gated ``eval`` group present.

SEED = (
    12  # Milestone 12 — surfaced in the report's `seed` field; the LLM is the only stochastic dep.
)
COMMUNITY = (
    "comm_" + "0" * 26
)  # the seeded `rules/comm_0…0.yaml` corpus the gold set is judged against
_GOLD = Path(__file__).resolve().parents[1] / "golden" / "gold.json"


@dataclass(frozen=True)
class TargetCase:
    """One judged case: the LLMTestCase plus the observable agent outputs the G-Eval metrics read."""

    case_id: str
    gold_verdict: str  # SME label: allow | flag
    disposition: str  # agent: approve | remove | escalate_to_human
    cited_rules: tuple[str, ...]
    confidence: float
    departs_from_precedent: bool
    test_case: Any  # an LLMTestCase — typed Any so the module imports without the eval group


def _llm_test_case(*, input_text: str, actual_output: str, retrieval_context: list[str]) -> Any:
    # Imported lazily: deepeval is only present in the key-gated `eval` group, and only a test that has
    # already passed `importorskip("deepeval")` ever reaches here.
    from deepeval.test_case import LLMTestCase

    return LLMTestCase(
        input=input_text, actual_output=actual_output, retrieval_context=retrieval_context
    )


def _corpus_entries(community_id: str = COMMUNITY) -> list[PolicyEntry]:
    return load_corpus_dir(RULES_DIR).get(community_id, [])


def load_gold_cases(limit: int | None = None) -> list[dict]:
    """The unanimous SME-gold posts (the ambiguous held-out cases are not used as ground truth)."""
    data = json.loads(_GOLD.read_text())
    cases = [c for c in data["cases"] if c["status"] == "gold"]
    return cases[:limit] if limit is not None else cases


def load_ambiguous_cases(limit: int | None = None) -> list[dict]:
    """The SME-ambiguous (non-unanimous) posts — the calibration / should-have-abstained target."""
    data = json.loads(_GOLD.read_text())
    cases = [c for c in data["cases"] if c["status"] == "ambiguous"]
    return cases[:limit] if limit is not None else cases


def _retrieval_texts(entries: list[PolicyEntry]) -> list[str]:
    # The retrieval_context DeepEval's RAG metrics judge against: the retrieved policy entry texts,
    # tagged by id so a faithfulness judge can tell whether a cited rule is actually present.
    return [f"{e.entry_id} [{e.entry_type}]: {e.text}" for e in entries]


def build_workflow(
    settings: Settings, community_id: str = COMMUNITY
) -> tuple[ModerationWorkflow, InMemoryPolicyCorpusStore]:
    """The REAL RAG target: live LLM + embedder over in-memory stores seeded from the corpus.

    Stores are in-memory (no Postgres/NATS) but the LLM and embedder are the production LangChain
    clients — so retrieval is real over the seeded corpus and the verdict is a genuine model call.
    """
    clock, ids, _ = seeded_trio()
    corpus = InMemoryPolicyCorpusStore()
    corpus.set_entries(community_id, _corpus_entries(community_id))
    workflow = ModerationWorkflow(
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
    return workflow, corpus


def _retrieval_limit(workflow: ModerationWorkflow) -> int:
    # The limit the draft node reasons over — a stable config value the corpus retrieve mirrors.
    return workflow._settings.moderator_retrieval_limit


async def run_case(
    workflow: ModerationWorkflow,
    corpus: InMemoryPolicyCorpusStore,
    case: dict,
    community_id: str = COMMUNITY,
) -> TargetCase:
    """Run one gold post through the live agent and shape an LLMTestCase from the result.

    ``actual_output`` is a serialized verdict (disposition + rationale + cited rules) so a faithfulness
    judge can check every claim against ``retrieval_context``; the structured fields ride alongside for
    the G-Eval / agentic metrics that reason over the disposition directly.
    """
    post = case["post"]
    suffix = case["id"].replace("cand_", "").rjust(26, "0")
    event = PostCreatedEvent(
        event_id="evt_" + suffix,
        post_id="post_" + suffix,
        community_id=community_id,
        author_id="user_" + "0" * 26,
        title="moderation review",
        body=post,
        created_at="2026-06-05T00:00:00.000Z",
    )
    decision = await workflow.run(event)
    entries = await corpus.retrieve(community_id, [], limit=_retrieval_limit(workflow))
    return _to_target_case(case, decision, post, _retrieval_texts(entries))


def _to_target_case(
    case: dict, decision: ModerationDecision | None, post: str, retrieval_context: list[str]
) -> TargetCase:
    if decision is None:
        # A Failed run (a provider/dependency error) — surface it as an escalation so the metrics see a
        # record rather than a crash; the conftest tally will reflect each metric's verdict.
        actual = (
            "disposition=escalate_to_human; rationale=workflow failed before producing a verdict"
        )
        return TargetCase(
            case_id=case["id"],
            gold_verdict=case["gold_verdict"],
            disposition="escalate_to_human",
            cited_rules=(),
            confidence=0.0,
            departs_from_precedent=False,
            test_case=_llm_test_case(
                input_text=post, actual_output=actual, retrieval_context=retrieval_context
            ),
        )
    actual = (
        f"disposition={decision.disposition}; "
        f"cited_rules={list(decision.cited_rules)}; "
        f"rationale={decision.rationale}"
    )
    return TargetCase(
        case_id=case["id"],
        gold_verdict=case["gold_verdict"],
        disposition=decision.disposition,
        cited_rules=tuple(decision.cited_rules),
        confidence=decision.confidence,
        departs_from_precedent=decision.departs_from_precedent,
        test_case=_llm_test_case(
            input_text=post, actual_output=actual, retrieval_context=retrieval_context
        ),
    )


@dataclass
class _Accumulator:
    """Deterministic metric tally the conftest folds into ``metrics`` of the OUTPUT-JSON CONTRACT.

    Append-only: a test records (metric_name, passed) per judged case; ``snapshot`` returns an
    immutable per-metric ``{passed, failed}`` view. No mutation of prior entries (coding-style rule)."""

    _passed: dict[str, int] = field(default_factory=dict)
    _failed: dict[str, int] = field(default_factory=dict)

    def record(self, metric: str, *, passed: bool) -> None:
        target = self._passed if passed else self._failed
        target[metric] = target.get(metric, 0) + 1

    def snapshot(self) -> dict[str, dict[str, int]]:
        names = set(self._passed) | set(self._failed)
        return {
            name: {"passed": self._passed.get(name, 0), "failed": self._failed.get(name, 0)}
            for name in sorted(names)
        }


ACCUMULATOR = _Accumulator()


def record_metric(metric: str, *, passed: bool) -> None:
    """Tests call this so the conftest can report a per-metric breakdown without re-running judges."""
    ACCUMULATOR.record(metric, passed=passed)
