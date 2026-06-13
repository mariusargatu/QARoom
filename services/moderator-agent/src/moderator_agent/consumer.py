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
from collections.abc import Awaitable, Callable
from typing import Protocol

from opentelemetry import context as otel_context
from opentelemetry.propagate import extract

from . import telemetry
from .config import Settings
from .schemas import PostCreatedEvent
from .subjects import parse_subject, posts_created_any_community
from .workflow.graph import ModerationWorkflow

POST_CREATED_SUBJECT = posts_created_any_community()

# The shared JetStream stream is created by a Node service on boot (@qaroom/messaging ensureStream),
# so the moderator may start first. Wait up to ~60s for it before giving up to a crash-loop restart.
_STREAM_WAIT_ATTEMPTS = 30
_STREAM_WAIT_INTERVAL_S = 2.0

# Poison backstop: the durable's delivery budget (mirrors webhooks' WEBHOOK_FANOUT_MAX_DELIVERIES).
# Even if a message is MISCLASSIFIED as transient and keeps being `nak`-ed, JetStream dead-letters it
# after this many delivery attempts, so one un-processable event cannot wedge the consumer forever.
_MAX_DELIVER = 5
# A transient failure is `nak`-ed WITH this delay (seconds), not a bare `nak`: redelivery backs off
# instead of hot-looping a still-unavailable dependency (LLM/DB blip) at full speed.
_NAK_DELAY_S = 5.0


class _DeliveredMessage(Protocol):
    """The slice of a NATS ``Msg`` the consume loop settles against (payload + how to ack/term/nak).
    A real ``nats.aio.msg.Msg`` satisfies it structurally; tests pass a minimal double."""

    data: bytes
    headers: dict[str, str] | None
    subject: str

    async def ack(self) -> None: ...
    async def term(self) -> None: ...
    async def nak(self, delay: float | None = None) -> None: ...


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
        # Create the durable WITH its delivery budget (max_deliver) up front, then bind a pull
        # subscription to it. Splitting create-then-bind (rather than letting `pull_subscribe`
        # auto-create an unbounded durable) is what lets the durable carry the poison backstop.
        await self._with_stream_wait(self._ensure_durable)
        self._sub = await self._subscribe_with_retry()
        self._task = asyncio.create_task(self._loop())

    async def _with_stream_wait(self, op: Callable[[], Awaitable[object]]) -> object:
        """Run a JetStream op, tolerating the boot race where no Node service has yet created the shared
        ``qaroom`` stream (owned by ``@qaroom/messaging``'s ``ensureStream``, not the moderator).
        Without this the moderator hard-crashes with ``stream not found`` and crash-loops until a
        publisher comes up; instead we retry with a short backoff, then surface the error if it never
        appears."""
        from nats.js.errors import NotFoundError

        for attempt in range(_STREAM_WAIT_ATTEMPTS):
            try:
                return await op()
            except NotFoundError:
                if attempt == _STREAM_WAIT_ATTEMPTS - 1:
                    raise
                await asyncio.sleep(_STREAM_WAIT_INTERVAL_S)
        raise AssertionError("unreachable")  # pragma: no cover

    async def _ensure_durable(self) -> object:
        """Create (idempotently) the durable pull consumer with a bounded ``max_deliver`` so a poison
        message that keeps failing is dead-lettered after ``_MAX_DELIVER`` attempts instead of being
        redelivered forever — the delivery-count backstop behind the per-message classification."""
        from nats.js.api import AckPolicy, ConsumerConfig

        return await self._js.add_consumer(  # type: ignore[attr-defined]
            self._settings.nats_stream,
            config=ConsumerConfig(
                durable_name=self._settings.moderator_subscription,
                filter_subject=POST_CREATED_SUBJECT,
                ack_policy=AckPolicy.EXPLICIT,
                max_deliver=_MAX_DELIVER,
            ),
        )

    async def _subscribe_with_retry(self) -> object:
        """Bind a pull subscription to the durable created by ``_ensure_durable`` (tolerating the same
        stream boot race). Kept as a named seam so the retry is unit-testable with a fake JetStream."""
        return await self._with_stream_wait(
            lambda: self._js.pull_subscribe(  # type: ignore[attr-defined]
                POST_CREATED_SUBJECT,
                durable=self._settings.moderator_subscription,
                stream=self._settings.nats_stream,
            )
        )

    async def _loop(self) -> None:
        from nats.errors import TimeoutError as NatsTimeout

        while not self._stop.is_set():
            try:
                messages = await self._sub.fetch(batch=10, timeout=2)  # type: ignore[attr-defined]
            except NatsTimeout:
                continue
            for msg in messages:
                await self._settle_one(msg)

    async def _settle_one(self, msg: _DeliveredMessage) -> None:
        """Process and settle ONE delivered message.

        Ack on success. A malformed or cross-tenant message raises ``ValueError`` (pydantic's
        ``ValidationError`` is a ``ValueError`` subclass; the tenant-leak guard raises ``ValueError``
        directly) — redelivery can never make it succeed, so ``term`` (dead-letter) it: one poison
        message cannot wedge the durable consumer forever (mirrors webhooks' poison→term). Any other
        failure is transient (LLM/DB/broker blip) — ``nak`` WITH a delay so redelivery backs off; the
        durable's ``max_deliver`` budget dead-letters it if it never recovers. A recorded ``Failed``
        decision (LLM down) does NOT raise — it acks (at-least-once + checkpointer dedup) and stays
        visible in ``/system/state`` for manual replay (ADR-0018 limitation)."""
        try:
            await handle_post_event(
                self._workflow,
                data=msg.data,
                headers=dict(msg.headers or {}),
                subject=msg.subject,
            )
            await msg.ack()
        except ValueError:
            await msg.term()
        except Exception:
            await msg.nak(delay=_NAK_DELAY_S)

    async def stop(self) -> None:
        self._stop.set()
        if self._task is not None:
            with contextlib.suppress(asyncio.CancelledError):
                self._task.cancel()
                await self._task
