"""In-memory store implementations — the deterministic doubles unit tests inject.

They honour the same contracts as the Postgres implementations: ``record`` dedups by ``event_id``,
``list_for`` is community-scoped and insertion-ordered. No cross-test shared state — a fresh instance
per test (Commitment: no shared mutable state across tests).
"""

from __future__ import annotations

from ..ports import (
    DecisionStore,
    IdempotencyStore,
    KnowledgeStore,
    PolicyCorpusStore,
    StoredResponse,
)
from ..schemas import CommunityRule, ModerationDecision, PolicyEntry


class InMemoryDecisionStore(DecisionStore):
    def __init__(self) -> None:
        self._by_id: dict[tuple[str, str], ModerationDecision] = {}
        self._by_event: dict[str, ModerationDecision] = {}

    async def record(self, decision: ModerationDecision) -> bool:
        if decision.event_id in self._by_event:
            return False
        self._by_event[decision.event_id] = decision
        self._by_id[(decision.community_id, decision.decision_id)] = decision
        return True

    async def find_by_event(self, community_id: str, event_id: str) -> ModerationDecision | None:
        found = self._by_event.get(event_id)
        return found if found and found.community_id == community_id else None

    async def list_for(self, community_id: str) -> list[ModerationDecision]:
        return [d for (c, _), d in self._by_id.items() if c == community_id]

    async def get(self, community_id: str, decision_id: str) -> ModerationDecision | None:
        return self._by_id.get((community_id, decision_id))

    async def count(self) -> int:
        return len(self._by_id)


class InMemoryKnowledgeStore(KnowledgeStore):
    def __init__(self, rules: dict[str, list[CommunityRule]] | None = None) -> None:
        self._rules: dict[str, list[CommunityRule]] = rules or {}
        self._summaries: list[tuple[str, str]] = []  # (community_id, summary)

    def set_rules(self, community_id: str, rules: list[CommunityRule]) -> None:
        self._rules[community_id] = rules

    async def rules_for(self, community_id: str) -> list[CommunityRule]:
        return list(self._rules.get(community_id, []))

    async def similar(
        self, community_id: str, embedding: list[float], *, limit: int = 3
    ) -> list[str]:
        # The fake embedder yields a constant vector, so there is no meaningful nearest-neighbour
        # ranking — return the most recent decisions for the same community as precedent context.
        return [s for (c, s) in self._summaries if c == community_id][-limit:]

    async def remember(
        self,
        *,
        post_id: str,
        community_id: str,
        title: str,
        body: str,
        embedding: list[float],
        decision: ModerationDecision,
    ) -> None:
        rules = ", ".join(decision.cited_rules) if decision.cited_rules else "no rule"
        self._summaries.append(
            (community_id, f"{decision.disposition} ({rules}): {decision.rationale}")
        )

    async def count_embeddings(self) -> int:
        return len(self._summaries)


class InMemoryPolicyCorpusStore(PolicyCorpusStore):
    """Deterministic double for the policy corpus. The zero embedder gives no nearest-neighbour
    ranking, so ``retrieve`` returns the community's reasoned entries in a stable id order — enough to
    drive the workflow + assert citation grounding without a live embedder."""

    _REASONED = ("rule", "guideline")

    def __init__(self, entries: dict[str, list[PolicyEntry]] | None = None) -> None:
        self._entries: dict[str, list[PolicyEntry]] = entries or {}

    def set_entries(self, community_id: str, entries: list[PolicyEntry]) -> None:
        self._entries[community_id] = entries

    async def retrieve(
        self, community_id: str, embedding: list[float], *, limit: int = 5
    ) -> list[PolicyEntry]:
        reasoned = [e for e in self._entries.get(community_id, []) if e.entry_type in self._REASONED]
        return sorted(reasoned, key=lambda e: e.entry_id)[:limit]

    async def corpus_for(self, community_id: str) -> list[PolicyEntry]:
        return list(self._entries.get(community_id, []))

    async def count_entries(self) -> int:
        return sum(len(v) for v in self._entries.values())


class InMemoryIdempotencyStore(IdempotencyStore):
    """Deterministic double for the HTTP idempotency cache — same semantics as the Postgres store."""

    def __init__(self) -> None:
        self._by_key: dict[tuple[str, str, str], StoredResponse] = {}

    async def find(self, *, key: str, route: str, body_hash: str) -> StoredResponse | None:
        return self._by_key.get((key, route, body_hash))

    async def conflicts(self, *, key: str, route: str, body_hash: str) -> bool:
        return any(k == key and r == route and h != body_hash for (k, r, h) in self._by_key)

    async def store(
        self, *, key: str, route: str, body_hash: str, status: int, body: dict, created_at: str
    ) -> None:
        # First write wins (the Postgres ON CONFLICT DO NOTHING analogue).
        self._by_key.setdefault((key, route, body_hash), StoredResponse(status=status, body=body))
