"""The moderation workflow state model — the LangGraph sibling of ``rollout.machine.ts``.

Hand-authored, context-free, and the SINGLE authority on transition legality. The LangGraph runner
(``graph.py``) and the reverse-conformance test both read this — exactly the discipline ADR-0012
established for the XState machines. As of Milestone 12 (ADR-0020) the agent is a retrieval-grounded
RAG trajectory (FR6); two-stage retrieval (ADR-0021) inserts a ``rerank`` node, so each review of one
post walks six observable nodes:

    Received --ReviewRequested--> Retrieved          (retrieve a wide candidate set from the corpus)
             --CandidatesReranked--> Reranked        (rerank candidates to top-k — the LLM reranker)
             --PolicyRetrieved--> PrecedentGathered  (gather similar past decisions)
             --PrecedentCollected--> Drafted         (draft a citation-bearing disposition — the LLM)
             --DraftProduced--> SelfChecked          (validate citations, set departs/abstain — pure)
             --SelfCheckPassed--> Recorded           (persist + publish)

Any I/O node may fail to its dependency (corpus, reranker, embeddings, LLM, DB), modeled as an
explicit event:

    {Received|Retrieved|Reranked|PrecedentGathered|SelfChecked} --DependencyFailed--> Failed

The self-check (Drafted→SelfChecked) is PURE validation — no I/O — so it declares no failure edge; the
model declares only transitions the graph can actually emit (matching the original M9 discipline).

States are PascalCase nouns; events are PascalCase verbs (docs/05). ``Recorded`` and ``Failed`` are
terminal. The DISPOSITION (approve/remove/escalate_to_human) is per-review DATA carried in the run
state and the decision row — NOT a state: an escalation is still a *recorded* decision and reuses the
same persist/publish/idempotency path, so the topology stays context-free and statically traversable.
"""

from __future__ import annotations

MACHINE = "moderator"
INITIAL_STATE = "Received"
STATES: tuple[str, ...] = (
    "Received",
    "Retrieved",
    "Reranked",
    "PrecedentGathered",
    "Drafted",
    "SelfChecked",
    "Recorded",
    "Failed",
)
EVENTS: tuple[str, ...] = (
    "ReviewRequested",
    "CandidatesReranked",
    "PolicyRetrieved",
    "PrecedentCollected",
    "DraftProduced",
    "SelfCheckPassed",
    "DependencyFailed",
)
TERMINAL_STATES = frozenset({"Recorded", "Failed"})

# (from, event, to). The one place transition legality is declared.
TRANSITIONS: tuple[tuple[str, str, str], ...] = (
    ("Received", "ReviewRequested", "Retrieved"),
    ("Retrieved", "CandidatesReranked", "Reranked"),
    ("Reranked", "PolicyRetrieved", "PrecedentGathered"),
    ("PrecedentGathered", "PrecedentCollected", "Drafted"),
    ("Drafted", "DraftProduced", "SelfChecked"),
    ("SelfChecked", "SelfCheckPassed", "Recorded"),
    ("Received", "DependencyFailed", "Failed"),
    ("Retrieved", "DependencyFailed", "Failed"),
    ("Reranked", "DependencyFailed", "Failed"),
    ("PrecedentGathered", "DependencyFailed", "Failed"),
    ("SelfChecked", "DependencyFailed", "Failed"),
)

_BY_FROM_EVENT: dict[tuple[str, str], str] = {(frm, event): to for frm, event, to in TRANSITIONS}


def next_state(current: str, event: str) -> str | None:
    """The legal target for ``event`` from ``current``, or ``None`` if no such transition exists."""
    return _BY_FROM_EVENT.get((current, event))


def is_legal(frm: str, event: str, to: str) -> bool:
    return (frm, event, to) in TRANSITIONS
