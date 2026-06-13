"""Poison-message settling (C16): the consume loop must distinguish a malformed event (term →
dead-letter, never redelivered) from a transient failure (nak-with-delay → redelivered, backed off),
so one un-processable event cannot nak-loop the durable consumer forever.
"""

from __future__ import annotations

import moderator_agent.consumer as consumer_mod
from helpers import COMMUNITY, make_event, make_workflow
from moderator_agent.config import Settings
from moderator_agent.consumer import PostEventConsumer
from moderator_agent.schemas import LlmVerdict
from moderator_agent.subjects import post_created


class _FakeMsg:
    """A minimal NATS ``Msg`` double recording how it was settled — no broker. Structurally satisfies
    the consumer's ``_DeliveredMessage`` Protocol (data/headers/subject + async ack/term/nak)."""

    def __init__(self, *, data: bytes, subject: str, headers: dict[str, str] | None = None) -> None:
        self.data = data
        self.subject = subject
        self.headers = headers
        self.ack_calls = 0
        self.term_calls = 0
        self.nak_delays: list[float | None] = []

    async def ack(self) -> None:
        self.ack_calls += 1

    async def term(self) -> None:
        self.term_calls += 1

    async def nak(self, delay: float | None = None) -> None:
        self.nak_delays.append(delay)


class _BoomLlm:
    """An LLM whose only call raises a transient (non-ProblemError) error. It escapes the workflow's
    per-node ProblemError handling and propagates out of ``handle_post_event`` as a transient failure,
    so the consumer must nak-with-delay (redeliver) rather than term it."""

    @property
    def model(self) -> str:
        return "boom-transient"

    def classify(self, *, system_prompt: str, post_text: str) -> LlmVerdict:
        raise ConnectionError("LLM provider temporarily unreachable")


async def test_malformed_payload_is_termed_and_not_redelivered() -> None:
    # A payload that cannot be parsed raises pydantic ValidationError (a ValueError subclass).
    # Redelivery can never make it succeed, so the consumer terms (dead-letters) it — never naks.
    workflow, _, _ = make_workflow()
    consumer = PostEventConsumer(Settings(), workflow, None)
    msg = _FakeMsg(data=b"this is not valid json", subject=post_created(COMMUNITY))
    await consumer._settle_one(msg)
    assert msg.term_calls == 1
    assert msg.nak_delays == []  # NOT redelivered
    assert msg.ack_calls == 0


async def test_transient_failure_is_nakd_with_delay_for_redelivery() -> None:
    # A transient dependency blip (here the LLM raising a non-ProblemError) is NOT poison: the consumer
    # naks WITH the configured delay (redeliver, backed off) and must never term it.
    workflow, _, _ = make_workflow(llm=_BoomLlm())
    consumer = PostEventConsumer(Settings(), workflow, None)
    event = make_event()
    msg = _FakeMsg(
        data=event.model_dump_json().encode(),
        subject=post_created(event.community_id),
    )
    await consumer._settle_one(msg)
    assert msg.nak_delays == [consumer_mod._NAK_DELAY_S]  # nak with delay → redelivered
    assert msg.term_calls == 0
    assert msg.ack_calls == 0
