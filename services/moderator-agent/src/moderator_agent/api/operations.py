"""The operation registry — the single source feeding ``/system/capabilities`` (Commitment 7).

Mirrors the TS ``operations.ts`` pattern: hand-wired routes MUST stay in lockstep with this list, and
a completeness test pins them together. Each entry is MCP-tool-shaped so an agent (and the future
Milestone-10 MCP server) can discover what the moderator exposes.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..ids import branded_pattern


@dataclass(frozen=True)
class Operation:
    operation_id: str
    method: str
    path: str
    summary: str
    description: str
    mutating: bool
    input_schema: dict


_COMMUNITY_ID = {"type": "string", "pattern": branded_pattern("comm")}
_DECISION_ID = {"type": "string", "pattern": branded_pattern("mdec")}
_POST_ID = {"type": "string", "pattern": branded_pattern("post")}


def _obj(props: dict, required: list[str]) -> dict:
    return {
        "type": "object",
        "properties": props,
        "required": required,
        "additionalProperties": False,
    }


OPERATIONS: tuple[Operation, ...] = (
    Operation(
        operation_id="getSystemState",
        method="GET",
        path="/system/state",
        summary="Observable state of the moderator",
        description="Model counts (decisions, embeddings) and the current workflow state, with an as_of envelope.",
        mutating=False,
        input_schema=_obj({}, []),
    ),
    Operation(
        operation_id="getSystemCapabilities",
        method="GET",
        path="/system/capabilities",
        summary="MCP-tool-shaped list of operations",
        description="Every operation this service exposes, with its JSON Schema input (Commitment 7).",
        mutating=False,
        input_schema=_obj({}, []),
    ),
    Operation(
        operation_id="listModerationDecisions",
        method="GET",
        path="/api/communities/{communityId}/moderation-decisions",
        summary="List moderation decisions for a community",
        description="Every decision the agent has recorded for the community, with an as_of envelope.",
        mutating=False,
        input_schema=_obj({"communityId": _COMMUNITY_ID}, ["communityId"]),
    ),
    Operation(
        operation_id="getModerationDecision",
        method="GET",
        path="/api/communities/{communityId}/moderation-decisions/{decisionId}",
        summary="Fetch one moderation decision",
        description="A single decision by id, or RFC 7807 not_found.",
        mutating=False,
        input_schema=_obj(
            {"communityId": _COMMUNITY_ID, "decisionId": _DECISION_ID},
            ["communityId", "decisionId"],
        ),
    ),
    Operation(
        operation_id="reviewPost",
        method="POST",
        path="/api/communities/{communityId}/posts/{postId}/review",
        summary="Review a post now (manual/demo trigger)",
        description=(
            "Run the moderation workflow for a post synchronously and return the decision. The "
            "production path is the NATS consumer; this endpoint drives the same workflow. Requires "
            "an Idempotency-Key header; replay-safe by the post's event_id."
        ),
        mutating=True,
        input_schema=_obj(
            {
                "communityId": _COMMUNITY_ID,
                "postId": _POST_ID,
                "event_id": {"type": "string", "pattern": branded_pattern("evt")},
                "author_id": {"type": "string", "pattern": branded_pattern("user")},
                "title": {"type": "string"},
                "body": {"type": "string"},
                "created_at": {"type": "string"},
            },
            ["communityId", "postId", "event_id", "author_id", "title", "body", "created_at"],
        ),
    ),
)
