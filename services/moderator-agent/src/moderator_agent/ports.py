"""Ports the workflow depends on — abstractions so unit tests wire in-memory fakes and production
wires the Postgres/pgvector/NATS implementations (the repo's inject-everything discipline)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from .schemas import CommunityRule, ModerationDecision


@runtime_checkable
class DecisionStore(Protocol):
    async def record(self, decision: ModerationDecision) -> bool:
        """Persist a decision. Returns ``False`` if a decision for the same ``event_id`` already
        exists (the dedup belt to LangGraph's checkpointer suspenders), ``True`` if newly written."""
        ...

    async def find_by_event(self, community_id: str, event_id: str) -> ModerationDecision | None:
        """The decision already recorded for ``event_id``, if any — used to make replay return the
        original decision (and its id) rather than a freshly minted one."""
        ...

    async def list_for(self, community_id: str) -> list[ModerationDecision]: ...
    async def get(self, community_id: str, decision_id: str) -> ModerationDecision | None: ...
    async def count(self) -> int: ...


@runtime_checkable
class KnowledgeStore(Protocol):
    async def rules_for(self, community_id: str) -> list[CommunityRule]: ...
    async def similar(
        self, community_id: str, embedding: list[float], *, limit: int = 3
    ) -> list[str]: ...
    async def remember(
        self,
        *,
        post_id: str,
        community_id: str,
        title: str,
        body: str,
        embedding: list[float],
        decision: ModerationDecision,
    ) -> None: ...
    async def count_embeddings(self) -> int: ...


@runtime_checkable
class EventPublisher(Protocol):
    async def publish(
        self,
        *,
        subject: str,
        event_name: str,
        event_version: int,
        community_id: str,
        event_id: str,
        payload: dict,
    ) -> None: ...


@dataclass(frozen=True)
class StoredResponse:
    """A cached HTTP response replayed for a repeated Idempotency-Key (Commitment 4)."""

    status: int
    body: dict


@runtime_checkable
class IdempotencyStore(Protocol):
    """Per-service ``idempotency_responses`` (Commitment 4). Keyed by ``(key, route, body_hash)``:
    same key + same body returns the stored response; same key + different body is a conflict."""

    async def find(self, *, key: str, route: str, body_hash: str) -> StoredResponse | None:
        """The response stored for this exact (key, route, body), if any — replayed verbatim."""
        ...

    async def conflicts(self, *, key: str, route: str, body_hash: str) -> bool:
        """True if this (key, route) was already used with a DIFFERENT body — an RFC 9110 conflict."""
        ...

    async def store(
        self, *, key: str, route: str, body_hash: str, status: int, body: dict, created_at: str
    ) -> None:
        """Persist a fresh response. Concurrent first-writers race harmlessly (first write wins)."""
        ...
