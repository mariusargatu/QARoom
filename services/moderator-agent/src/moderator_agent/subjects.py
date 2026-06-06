"""NATS subject builders (docs/05 §3, Commitment 17), Python mirror of ``contracts/src/subjects.ts``.

Grammar: ``qaroom.<service>.<entity>.<community_id>.<event>`` with ``community_id`` at the fixed
third position — the subject IS the tenancy boundary, so a wildcard subscriber cannot leak across
tenants by accident. The moderator subscribes cross-tenant (``posts_created_any_community``) and
re-validates ``community_id`` against the subject on every message.

This file is the Python sibling of ``subjects.ts``. Drift between the two is gated by
``tests/test_subjects_crosslang.py`` against a golden emitted from the TypeScript source.
"""

from __future__ import annotations

from .ids import CommunityId, is_branded

_ROOT = "qaroom"
_CONTENT = "content"
_MODERATOR = "moderator"


def post_created(community_id: str) -> str:
    return f"{_ROOT}.{_CONTENT}.posts.{community_id}.created"


def posts_created_any_community() -> str:
    """Cross-tenant subscription: ``post.created`` across every community (moderator only)."""
    return f"{_ROOT}.{_CONTENT}.posts.*.created"


def moderation_decision_recorded(community_id: str) -> str:
    return f"{_ROOT}.{_MODERATOR}.decision.{community_id}.recorded"


# AsyncAPI channel address (parameterized form), mirrors MODERATION_DECISION_RECORDED_ADDRESS in TS.
MODERATION_DECISION_RECORDED_ADDRESS = f"{_ROOT}.{_MODERATOR}.decision.{{community_id}}.recorded"

# Canonical event name + version — the Python mirror of the TS contract constants
# (packages/contracts/src/events/moderation-decision-recorded.ts). Declared here, not inline in the
# workflow, so there is one Python home for the event's contract metadata.
MODERATION_DECISION_RECORDED_EVENT = "moderation.decision.recorded"
# Bumped 1→2 by the M12 breaking change (verdict → disposition + citations, ADR-0020). Cross-checked
# against the TS source via subjects.golden.json in tests/test_subjects_crosslang.py (R1 guard).
MODERATION_DECISION_RECORDED_VERSION = 2


class ParsedSubject:
    __slots__ = ("community_id", "entity", "event", "service")

    def __init__(self, service: str, entity: str, community_id: str, event: str) -> None:
        self.service = service
        self.entity = entity
        self.community_id = community_id
        self.event = event


def parse_subject(subject: str) -> ParsedSubject:
    """Parse against the grammar, enforcing ``community_id`` at position 3 — tenant-leak insurance."""
    parts = subject.split(".")
    if len(parts) != 5 or parts[0] != _ROOT:
        raise ValueError(
            f"malformed subject (expected {_ROOT}.<service>.<entity>.<community_id>.<event>): {subject}"
        )
    _, service, entity, community, event = parts
    if community != "*" and not is_branded("comm", community):
        raise ValueError(f"position-3 segment is neither '*' nor a CommunityId: {subject}")
    return ParsedSubject(service, entity, community, event)


# `CommunityId` is re-exported for callers that want the branded type alongside the builders.
__all__ = [
    "MODERATION_DECISION_RECORDED_ADDRESS",
    "MODERATION_DECISION_RECORDED_EVENT",
    "MODERATION_DECISION_RECORDED_VERSION",
    "CommunityId",
    "ParsedSubject",
    "moderation_decision_recorded",
    "parse_subject",
    "post_created",
    "posts_created_any_community",
]
