"""NATS JetStream publisher for the moderator's own events (Commitment 17 headers + OTel context).

Every emit carries the same headers as the TS services: ``Nats-Msg-Id`` (the ``evt_`` id, JetStream's
5-minute dedup key), ``tenant.id`` (the community), ``event-name``/``event-version``, and the W3C
trace-context carrier so the consumer can continue the originating trace. The moderator publishes
``moderation.decision.recorded``; downstream consumers must dedup on ``Nats-Msg-Id`` (ADR-0018).
"""

from __future__ import annotations

import json

from opentelemetry.propagate import inject

from .ports import EventPublisher

HEADER_MSG_ID = "Nats-Msg-Id"
HEADER_TENANT = "tenant.id"
HEADER_EVENT_NAME = "event-name"
HEADER_EVENT_VERSION = "event-version"


class NatsEventPublisher(EventPublisher):
    def __init__(self, js: object) -> None:
        # `js` is a nats.js.JetStreamContext; typed loosely to avoid importing the client at construction.
        self._js = js

    async def publish(
        self,
        *,
        subject: str,
        event_name: str,
        event_version: int,
        community_id: str,
        event_id: str,
        payload: dict,
    ) -> None:
        headers: dict[str, str] = {
            HEADER_MSG_ID: event_id,
            HEADER_TENANT: community_id,
            HEADER_EVENT_NAME: event_name,
            HEADER_EVENT_VERSION: str(event_version),
        }
        inject(headers)  # W3C traceparent/tracestate so the consumer continues this trace
        data = json.dumps(payload, separators=(",", ":")).encode()
        await self._js.publish(subject, data, headers=headers)  # type: ignore[attr-defined]
