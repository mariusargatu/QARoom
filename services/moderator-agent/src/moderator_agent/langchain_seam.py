"""Shared LangChain construction + the ONE 502-on-provider-failure surface for the chat seams.

Owns the two things the LLM client (``llm.py``) and the reranker (``rerank.py``) both need, so they
cannot drift apart:

- ``dependency_failure`` — the security-sensitive posture: log the provider's raw error server-side,
  return a generic, retryable RFC 7807 502 that never echoes an SDK message (which could carry request
  or credential detail). One place to audit instead of two.
- ``build_structured_runnable`` — the provider-agnostic chat-model CONSTRUCTION (the ADR-0017
  "provider is a config string" kwarg promise: ``init_chat_model`` + the reasoning-vs-temperature
  ``reasoning_effort`` quirk) wrapped in ``with_structured_output``. Construction ONLY — each client
  keeps its own double-checked lock + lazy field, so the threading concern stays local to the client.

The embedder (``init_embeddings``, api-key only, no structured output) is deliberately NOT routed
through here — it is genuinely different and stays in ``llm.py``.
"""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.runnables import Runnable
from pydantic import BaseModel

from .config import Settings
from .problem import ProblemError

_logger = logging.getLogger("qaroom.moderator.seam")


def dependency_failure(slug: str, title: str, cause: str) -> ProblemError:
    # Log the provider's raw error server-side; do NOT echo it to the client — an SDK message could
    # carry request or credential detail (security review). The client gets a generic, retryable 502.
    _logger.error("%s: %s", slug, cause)
    return ProblemError(
        slug=slug,
        title=title,
        status=502,
        failure_domain="dependency_failure",
        detail="the model provider call failed; see service logs",
        retryable=True,
    )


def _provider_kwargs(settings: Settings) -> dict[str, Any]:
    # Reasoning models (gpt-5.x) take `reasoning_effort`, not `seed`/`temperature`. Pass key + effort
    # only when configured; init_chat_model forwards extra kwargs to the provider class, whose overloads
    # are not typed for them (hence the ignore at the call site). ADR-0017.
    extra: dict[str, Any] = {}
    if settings.openai_api_key:
        extra["api_key"] = settings.openai_api_key
    if settings.moderator_reasoning_effort:
        extra["reasoning_effort"] = settings.moderator_reasoning_effort
    return extra


def build_structured_runnable(
    settings: Settings, schema: type[BaseModel], *, include_raw: bool = False
) -> Runnable:
    """A provider-agnostic chat model wrapped in ``with_structured_output(schema)``.

    ``init_chat_model`` is imported lazily so the service still boots (and serves /health, /ready)
    without an API key — the key is only needed once a post is actually classified/reranked (ADR-0018).
    ``include_raw`` is forwarded verbatim: the LlmClient path passes True (it reads
    ``raw.usage_metadata`` + the parsing error); the reranker keeps the False default."""
    from langchain.chat_models import init_chat_model

    model = init_chat_model(settings.moderator_model, **_provider_kwargs(settings))  # pyright: ignore[reportArgumentType]
    return model.with_structured_output(schema, include_raw=include_raw)
