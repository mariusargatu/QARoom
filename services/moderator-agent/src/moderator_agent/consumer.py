"""NATS JetStream consumer: subscribe to ``post.created`` across every community, review each post.

The moderator is the project's one cross-tenant consumer. It subscribes with the wildcard subject
(``qaroom.content.posts.*.created``) and re-validates ``community_id`` against the subject on every
message — the tenant-leak insurance the architecture requires of any wildcard subscriber (docs/05 §3).

Dedup is delegated to LangGraph's checkpointer via ``thread_id = event_id`` (ADR-0018), not a
``processed_events`` table. The per-message handler is split out so it is unit-testable with a fake
message and no broker.
"""

from __future__ import annotations

import asyncio
import contextlib

from opentelemetry import context as otel_context
from opentelemetry.propagate import extract

from . import telemetry
from .config import Settings
from .schemas import PostCreatedEvent
from .subjects import parse_subject, posts_created_any_community
from .workflow.graph import ModerationWorkflow

POST_CREATED_SUBJECT = posts_created_any_community()


async def handle_post_event(
    workflow: ModerationWorkflow, *, data: bytes, headers: dict[str, str], subject: str
) -> None:
    """Review one delivered ``post.created`` message. Raises on a malformed/cross-tenant message."""
    parsed = parse_subject(subject)
    event = PostCreatedEvent.model_validate_json(data)
    if parsed.community_id not in ("*", event.community_id):
        raise ValueError(
            f"tenant leak: subject community {parsed.community_id} != payload {event.community_id}"
        )
    token = otel_context.attach(extract(headers))
    try:
        with telemetry.tenant_scope(event.community_id):
            await workflow.run(event)
    finally:
        otel_context.detach(token)


class PostEventConsumer:
    def __init__(self, settings: Settings, workflow: ModerationWorkflow, js: object) -> None:
        self._settings = settings
        self._workflow = workflow
        # Shared JetStream context — the NATS connection is owned by the caller (wiring), so the
        # publisher and consumer reuse one connection rather than opening two.
        self._js = js
        self._stop = asyncio.Event()
        self._task: asyncio.Task | None = None
        self._sub: object = None

    async def start(self) -> None:
        self._sub = await self._js.pull_subscribe(  # type: ignore[attr-defined]
            POST_CREATED_SUBJECT,
            durable=self._settings.moderator_subscription,
            stream=self._settings.nats_stream,
        )
        self._task = asyncio.create_task(self._loop())

    async def _loop(self) -> None:
        from nats.errors import TimeoutError as NatsTimeout

        while not self._stop.is_set():
            try:
                messages = await self._sub.fetch(batch=10, timeout=2)  # type: ignore[attr-defined]
            except NatsTimeout:
                continue
            for msg in messages:
                try:
                    await handle_post_event(
                        self._workflow,
                        data=msg.data,
                        headers=dict(msg.headers or {}),
                        subject=msg.subject,
                    )
                    await msg.ack()
                except Exception:
                    # Malformed or transient: nak for redelivery. A recorded `Failed` decision (LLM
                    # down) does not raise — it acks (at-least-once + checkpointer dedup), and is
                    # visible in /system/state for manual replay (ADR-0018 limitation).
                    await msg.nak()

    async def stop(self) -> None:
        self._stop.set()
        if self._task is not None:
            with contextlib.suppress(asyncio.CancelledError):
                self._task.cancel()
                await self._task
