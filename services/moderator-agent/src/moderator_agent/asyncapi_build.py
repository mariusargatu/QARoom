"""Generate the committed ``asyncapi.yaml`` for the moderator's emitted event.

The payload schema is the Zod-derived cross-language JSON Schema (``contracts/…schema.json``) — the
single source of truth — so the AsyncAPI document, the Pydantic producer, and the TS consumers all
describe one wire format. A pytest drift gate asserts the committed file matches this output.
"""

from __future__ import annotations

import json
from pathlib import Path

import yaml

from .subjects import MODERATION_DECISION_RECORDED_ADDRESS

_ROOT = Path(__file__).resolve().parents[2]
OUT = _ROOT / "asyncapi.yaml"
_PAYLOAD_SCHEMA = _ROOT / "contracts" / "moderation-decision-recorded.schema.json"


def render() -> str:
    payload = json.loads(_PAYLOAD_SCHEMA.read_text())
    spec = {
        "asyncapi": "3.0.0",
        "info": {
            "title": "moderator-agent",
            "version": "0.0.0",
            "description": "Events emitted by the QARoom moderator-agent (Milestone 9).",
        },
        "servers": {
            "nats": {"host": "qaroom-nats:4222", "protocol": "nats"},
        },
        "channels": {
            "moderationDecisionRecorded": {
                "address": MODERATION_DECISION_RECORDED_ADDRESS,
                "parameters": {
                    "community_id": {
                        "description": "Tenancy boundary at the fixed third subject position.",
                    },
                },
                "messages": {
                    "moderationDecisionRecorded": {
                        "$ref": "#/components/messages/moderationDecisionRecorded",
                    },
                },
            },
        },
        "operations": {
            "sendModerationDecisionRecorded": {
                "action": "send",
                "channel": {"$ref": "#/channels/moderationDecisionRecorded"},
                "messages": [
                    {
                        "$ref": "#/channels/moderationDecisionRecorded/messages/moderationDecisionRecorded"
                    },
                ],
            },
        },
        "components": {
            "messages": {
                "moderationDecisionRecorded": {
                    "name": "moderation.decision.recorded",
                    "title": "Moderation decision recorded",
                    "summary": "The agent recorded a verdict for a post (it proposes; it does not enforce).",
                    "contentType": "application/json",
                    "payload": payload,
                },
            },
        },
    }
    return yaml.safe_dump(spec, sort_keys=False)


def main() -> None:
    OUT.write_text(render())
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
