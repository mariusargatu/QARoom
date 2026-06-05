"""The moderation workflow state model — the LangGraph sibling of ``rollout.machine.ts``.

Hand-authored, context-free, and the SINGLE authority on transition legality. The LangGraph runner
(``graph.py``) and the reverse-conformance test both read this — exactly the discipline ADR-0012
established for the XState machines. Each review of one post walks:

    Received --ReviewRequested--> Retrieved --ContextRetrieved--> Classified --VerdictProduced--> Recorded

Any node may fail to its dependency (LLM, embeddings, DB), which is modeled as an explicit event:

    {Received|Retrieved|Classified} --DependencyFailed--> Failed

States are PascalCase nouns; events are PascalCase verbs (docs/05). ``Recorded`` and ``Failed`` are
terminal. Per-review data (the post, the verdict) lives in the run state and the decision row, never
in the model — keeping the graph context-free so it stays statically traversable.
"""

from __future__ import annotations

MACHINE = "moderator"
INITIAL_STATE = "Received"
STATES: tuple[str, ...] = ("Received", "Retrieved", "Classified", "Recorded", "Failed")
EVENTS: tuple[str, ...] = (
    "ReviewRequested",
    "ContextRetrieved",
    "VerdictProduced",
    "DependencyFailed",
)
TERMINAL_STATES = frozenset({"Recorded", "Failed"})

# (from, event, to). The one place transition legality is declared.
TRANSITIONS: tuple[tuple[str, str, str], ...] = (
    ("Received", "ReviewRequested", "Retrieved"),
    ("Retrieved", "ContextRetrieved", "Classified"),
    ("Classified", "VerdictProduced", "Recorded"),
    ("Received", "DependencyFailed", "Failed"),
    ("Retrieved", "DependencyFailed", "Failed"),
    ("Classified", "DependencyFailed", "Failed"),
)

_BY_FROM_EVENT: dict[tuple[str, str], str] = {(frm, event): to for frm, event, to in TRANSITIONS}


def next_state(current: str, event: str) -> str | None:
    """The legal target for ``event`` from ``current``, or ``None`` if no such transition exists."""
    return _BY_FROM_EVENT.get((current, event))


def is_legal(frm: str, event: str, to: str) -> bool:
    return (frm, event, to) in TRANSITIONS
