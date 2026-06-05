"""Pydantic schemas — the Python mirror of the Zod contracts (Commitment 3, ADR-0018).

The outbound ``ModerationDecisionRecordedEvent`` is the cross-service contract: its Pydantic JSON
output is validated against the Zod-generated JSON Schema
(``contracts/moderation-decision-recorded.schema.json``) by ``tests/test_schemas_crosslang.py``, so
the two languages can never silently disagree on the wire format. Producer models use
``extra="forbid"`` (we emit exactly the declared fields, matching the schema's
``additionalProperties:false``); the inbound ``PostCreatedEvent`` uses ``extra="ignore"`` so a newer
producer's additive field stays forward-compatible (conventions §2, mirroring Zod's strip).
"""

from __future__ import annotations

import datetime as _dt
from typing import Annotated, Literal, TypeAlias

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from .ids import CommunityId, EventId, ModerationDecisionId, PostId, UserId

_NO_NUL = r"^[^\x00]*$"

Title: TypeAlias = Annotated[str, StringConstraints(min_length=1, max_length=300, pattern=_NO_NUL)]
Body: TypeAlias = Annotated[str, StringConstraints(max_length=40_000, pattern=_NO_NUL)]
Reason: TypeAlias = Annotated[str, StringConstraints(max_length=2_000, pattern=_NO_NUL)]
ModelName: TypeAlias = Annotated[str, StringConstraints(min_length=1, max_length=100)]
RuleId: TypeAlias = Annotated[str, StringConstraints(max_length=100)]
Verdict: TypeAlias = Literal["allow", "flag"]
Severity: TypeAlias = Literal["low", "medium", "high"]
# ISO-8601 UTC with a `Z` suffix — the shape `iso_z` emits and a subset of the Zod
# `z.iso.datetime()` / JSON-Schema `date-time` pattern. Pydantic rejects a malformed timestamp at
# construction time (e.g. a missing `Z`), matching the wire contract rather than accepting any str.
IsoZ: TypeAlias = Annotated[
    str, StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$")
]

# Producer models hold a `model` field; opt out of pydantic's `model_` protected namespace.
_PRODUCED = ConfigDict(extra="forbid", protected_namespaces=())


def iso_z(when: _dt.datetime) -> str:
    """ISO-8601 with millisecond precision and a ``Z`` suffix — the form Zod's ``z.iso.datetime`` accepts."""
    return when.astimezone(_dt.UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class PostCreatedEvent(BaseModel):
    """Inbound from content-service. Lean but self-sufficient — no call back to fetch the post."""

    model_config = ConfigDict(extra="ignore")

    event_id: EventId
    post_id: PostId
    community_id: CommunityId
    author_id: UserId
    title: Title
    body: Body
    created_at: IsoZ


class LlmVerdict(BaseModel):
    """The structured output the LLM MUST return (OpenAI structured outputs / ``response_format``)."""

    model_config = ConfigDict(extra="forbid")

    verdict: Verdict
    rule_id: RuleId | None = None
    reason: Reason
    confidence: float = Field(ge=0, le=1)


class ModerationDecisionRecordedEvent(BaseModel):
    """Outbound — ``qaroom.moderator.decision.<community_id>.recorded``. Cross-service contract."""

    model_config = _PRODUCED

    event_id: EventId
    decision_id: ModerationDecisionId
    post_id: PostId
    community_id: CommunityId
    author_id: UserId
    verdict: Verdict
    rule_id: RuleId | None
    reason: Reason
    confidence: float = Field(ge=0, le=1)
    model: ModelName
    occurred_at: IsoZ


class ModerationDecision(BaseModel):
    """The agent's own decision record — its store + REST API surface (ADR-0018)."""

    model_config = _PRODUCED

    decision_id: ModerationDecisionId
    event_id: EventId
    post_id: PostId
    community_id: CommunityId
    author_id: UserId
    verdict: Verdict
    rule_id: RuleId | None
    reason: Reason
    confidence: float = Field(ge=0, le=1)
    model: ModelName
    created_at: IsoZ

    def to_event(self, event_id: str) -> ModerationDecisionRecordedEvent:
        return ModerationDecisionRecordedEvent(
            event_id=event_id,
            decision_id=self.decision_id,
            post_id=self.post_id,
            community_id=self.community_id,
            author_id=self.author_id,
            verdict=self.verdict,
            rule_id=self.rule_id,
            reason=self.reason,
            confidence=self.confidence,
            model=self.model,
            occurred_at=self.created_at,
        )


class CommunityRule(BaseModel):
    # Rules are operator-authored and version-controlled, but bound the prompt-injected text anyway
    # (defense-in-depth against an oversized rules file bloating the prompt).
    rule_id: RuleId
    text: Annotated[str, StringConstraints(min_length=1, max_length=4_000)]
    severity: Severity


class AsOfModel(BaseModel):
    snapshot_id: str
    lamport: int
    wall_clock: str


class ModerationDecisionList(BaseModel):
    decisions: list[ModerationDecision]
    as_of: AsOfModel


class SystemStateModel(BaseModel):
    service: str
    models: dict[str, object]
    as_of: AsOfModel


class CapabilityModel(BaseModel):
    operation_id: str
    method: str
    path: str
    summary: str
    description: str
    mutating: bool
    input_schema: dict[str, object]


class CapabilitiesModel(BaseModel):
    service: str
    capabilities: list[CapabilityModel]
    as_of: AsOfModel


class ReviewRequest(BaseModel):
    """Body for the manual/demo/test review trigger (``POST …/review``). Post fields come inline so a
    caller can drive a review without content-service (the NATS path is the production one)."""

    model_config = ConfigDict(extra="forbid")

    event_id: EventId
    post_id: PostId
    author_id: UserId
    title: Title
    body: Body
    created_at: IsoZ
