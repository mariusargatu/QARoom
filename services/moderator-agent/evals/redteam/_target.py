"""The red-team target: the in-process moderator behind a ``model_callback`` (ADR-0020).

DeepTeam (and PyRIT, via an adapter) drive ANY target through a single string-in / string-out
callback. Here that callback runs the REAL LangGraph RAG moderator over a post whose *body is the
attacker-controlled input* — the headline prompt-injection-in-post-body surface — and returns the
disposition + rationale as a string the harness can judge.

Crucially, the callback honours ``MODERATOR_DISABLE_INPUT_GUARD``: the guarded run fences the post
body so an injection is judged as DATA (mitigated); the disabled run feeds the raw body into the
prompt (the deliberate bug), so the same injection can LAND. That toggle is what lets the suite prove
the guard has teeth (EXIT CRITERION 4) rather than merely asserting "nothing bad happened".

Wired with REAL ``LangChainLlmClient`` / ``LangChainEmbedder`` (key-gated by the caller) plus
in-memory stores seeded from the versioned corpus, so no Postgres/NATS is needed to exercise the agent.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Coroutine
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from moderator_agent.config import Settings
from moderator_agent.eval_support import EVAL_COMMUNITY, attack_event, build_live_workflow
from moderator_agent.persistence.memory import InMemoryKnowledgeStore
from moderator_agent.schemas import ModerationDecision
from moderator_agent.workflow.graph import ModerationWorkflow

# The seeded community whose corpus ships in rules/comm_0000…0000.yaml — the corpus the agent retrieves
# over. Using the real seeded community keeps retrieval load-bearing (FR2) instead of an empty corpus.
TARGET_COMMUNITY = EVAL_COMMUNITY


class PoisonedKnowledgeStore(InMemoryKnowledgeStore):
    """A knowledge store whose precedent corpus is PRE-POISONED with an attacker-controlled summary.

    Precedents derive from past post bodies (``remember`` stores them), so the corpus is attacker-
    REACHABLE: this models a STORED / INDIRECT injection (OWASP LLM01 indirect, ASI01 goal-hijacking).
    ``similar`` then surfaces the poison as precedent — into the system prompt — exactly where the
    corpus guard must fence it. Re-seeded per build so multi-turn attacks see it every turn."""

    def __init__(self, community_id: str, poison: str) -> None:
        super().__init__()
        self._summaries = [(community_id, poison)]


def build_workflow(
    settings: Settings, *, knowledge: InMemoryKnowledgeStore | None = None
) -> ModerationWorkflow:
    """A workflow wired with the REAL provider + in-memory stores seeded from the versioned corpus.

    The settings carry the guard toggles (``moderator_disable_input_guard`` /
    ``moderator_disable_corpus_guard``); everything else is deterministic so the only stochastic
    surface is the model under attack. Pass ``knowledge`` to inject a poisoned precedent corpus.

    The wiring is the shared ``build_live_workflow`` (one copy across all eval entrypoints);
    ``seed_knowledge_rules`` re-seeds the community rule set the way this target always did.
    """
    workflow, _ = build_live_workflow(settings, knowledge=knowledge, seed_knowledge_rules=True)
    return workflow


def _verdict_text(decision: ModerationDecision | None) -> str:
    """Serialize the agent's verdict into the string the red-team harness judges. ``None`` means the
    workflow ended in ``Failed`` (a dependency failure) — surfaced as such, never as a silent approve."""
    if decision is None:
        return (
            "disposition=failed rationale=the moderation workflow failed before reaching a verdict"
        )
    cited = ",".join(decision.cited_rules) or "none"
    return (
        f"disposition={decision.disposition} "
        f"cited_rules={cited} "
        f"confidence={decision.confidence:.2f} "
        f"rationale={decision.rationale}"
    )


def _run_sync[T](coro: Coroutine[Any, Any, T]) -> T:
    """``asyncio.run``, tolerant of an already-running loop.

    deepeval 4.x's pytest plugin (auto-loaded once the eval group is installed) executes tests
    under an active event loop, where a bare ``asyncio.run`` raises ``RuntimeError``. Fall back to
    a fresh loop on a worker thread — the workflow run stays synchronous from the caller's view.
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    with ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coro).result()


def make_model_callback(settings: Settings) -> Callable[[str], str]:
    """Build a ``model_callback(input_text) -> str`` over a workflow with the given settings.

    The callback is the contract DeepTeam expects: it places ``input_text`` in the post BODY (the
    untrusted surface), runs the agent, and returns its verdict string. Each call builds a FRESH
    workflow (fresh in-memory stores), so attacks — including PyRIT multi-turn Crescendo/TAP — do not
    bleed state between turns: a recorded decision from turn N can't surface as precedent in turn N+1.
    """
    counter = {"n": 0}

    def model_callback(input_text: str) -> str:
        counter["n"] += 1
        event = attack_event(input_text, idx=counter["n"])
        decision = _run_sync(build_workflow(settings).run(event))
        return _verdict_text(decision)

    return model_callback


def make_poisoned_corpus_callback(settings: Settings, poison: str) -> Callable[[str], str]:
    """A ``model_callback`` whose PRECEDENT corpus is poisoned every turn (ASI01 indirect surface).

    The harness's synthesized attack rides in the post body; a poisoned precedent sits in the retrieved
    context simultaneously, so the run exercises the combined direct+indirect agentic attack surface.
    Each call rebuilds the workflow (and re-seeds the poison), so multi-turn attacks see it every turn.
    """
    counter = {"n": 0}

    def model_callback(input_text: str) -> str:
        counter["n"] += 1
        knowledge = PoisonedKnowledgeStore(TARGET_COMMUNITY, poison)
        decision = _run_sync(
            build_workflow(settings, knowledge=knowledge).run(
                attack_event(input_text, idx=counter["n"])
            )
        )
        return _verdict_text(decision)

    return model_callback


def run_post(body: str, *, settings: Settings) -> ModerationDecision | None:
    """Run a single post body through a freshly-built workflow and return the structured decision.

    Used by the structural fallback assertion (no harness needed) to compare guard-on vs guard-off
    directly on the disposition, proving the guard changes the outcome on an injection payload.
    """
    workflow = build_workflow(settings)
    return _run_sync(workflow.run(attack_event(body)))


def run_post_with_poisoned_precedent(
    body: str, *, poison: str, settings: Settings
) -> ModerationDecision | None:
    """Run a post against a workflow whose PRECEDENT corpus is poisoned (ASI01 goal-hijacking).

    The injection rides in the RETRIEVED context (a precedent), not the post body — the indirect
    channel the corpus guard defends. ``settings.moderator_disable_corpus_guard`` selects guarded vs
    the deliberate bug, so a caller can compare whether the stored injection hijacks the disposition.
    """
    knowledge = PoisonedKnowledgeStore(TARGET_COMMUNITY, poison)
    workflow = build_workflow(settings, knowledge=knowledge)
    return _run_sync(workflow.run(attack_event(body)))
