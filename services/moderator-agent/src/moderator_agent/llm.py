"""The LLM seam + deterministic test doubles.

Production wires LangChain's provider-agnostic ``init_chat_model`` (``with_structured_output`` over the
Pydantic ``LlmVerdict``) and ``init_embeddings`` (pgvector knowledge base). LangChain is the idiomatic
choice here — the workflow already runs on LangGraph — and it makes the provider a config string
(``openai:gpt-5.5`` → ``anthropic:…`` is a one-line change), which is the answer to the
vendor-objectivity caveat in ADR-0017. It also handles reasoning-vs-non-reasoning parameter quirks
(gpt-5.x reasoning models drop ``seed``/``temperature`` in favour of ``reasoning_effort``).

Unit tests wire the deterministic fakes so the workflow, persistence, and API are exercised without a
network call; the REAL provider is exercised by the DeepEval suite + metamorphic suite, which need
``OPENAI_API_KEY`` (decision: roadmap-literal real-OpenAI-in-CI, ADR-0017). A full record/replay
``ModelClient`` seam (cassettes + scripted oracle + a lint rule) is deferred to Milestone 14; here the
LLM is plain dependency injection behind the ``LlmClient`` Protocol (ADR-0018).
"""

from __future__ import annotations

import logging
import threading
from typing import Any, Protocol, cast, runtime_checkable

from langchain_core.embeddings import Embeddings
from langchain_core.runnables import Runnable

from . import telemetry
from .config import Settings
from .problem import ProblemError
from .schemas import LlmVerdict
from .tokenize import TiktokenTokenizer, Tokenizer

_logger = logging.getLogger("qaroom.moderator.llm")


@runtime_checkable
class LlmClient(Protocol):
    @property
    def model(self) -> str: ...
    def classify(self, *, system_prompt: str, post_text: str) -> LlmVerdict: ...


@runtime_checkable
class Embedder(Protocol):
    @property
    def model(self) -> str: ...
    def embed(self, text: str) -> list[float]: ...


def _dependency_failure(slug: str, title: str, cause: str) -> ProblemError:
    # Log the provider's raw error server-side; do NOT echo it to the client — an SDK message could
    # carry request or credential detail (security review). The client gets a generic, retryable problem.
    _logger.error("%s: %s", slug, cause)
    return ProblemError(
        slug=slug,
        title=title,
        status=502,
        failure_domain="dependency_failure",
        detail="the LLM provider call failed; see service logs",
        retryable=True,
    )


class LangChainLlmClient:
    """Provider-agnostic chat model via ``init_chat_model`` + ``with_structured_output``.

    Built LAZILY on first classify so the service boots (and serves /health, /ready) without an API
    key — the key is only needed once a post is actually classified (ADR-0018).
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._model_name = settings.moderator_model
        self._structured: Runnable | None = None
        # Guards lazy construction: classify runs in asyncio.to_thread, so concurrent first-requests
        # would otherwise both build the model (double-checked locking needs the lock).
        self._lock = threading.Lock()

    @property
    def model(self) -> str:
        return self._model_name

    def _ensure(self) -> Runnable:
        structured = self._structured
        if structured is None:
            with self._lock:
                structured = self._structured
                if structured is None:
                    from langchain.chat_models import init_chat_model

                    # Reasoning models (gpt-5.x) take `reasoning_effort`, not `seed`/`temperature`.
                    # Pass key + effort only when configured. init_chat_model forwards extra kwargs to
                    # the provider class; its overloads are not typed for them (hence the ignore).
                    extra: dict[str, Any] = {}
                    if self._settings.openai_api_key:
                        extra["api_key"] = self._settings.openai_api_key
                    if self._settings.moderator_reasoning_effort:
                        extra["reasoning_effort"] = self._settings.moderator_reasoning_effort
                    model = init_chat_model(self._model_name, **extra)  # pyright: ignore[reportArgumentType]
                    # include_raw keeps the AIMessage so we can read usage_metadata + a parsing error.
                    structured = model.with_structured_output(LlmVerdict, include_raw=True)
                    self._structured = structured
        return structured

    def classify(self, *, system_prompt: str, post_text: str) -> LlmVerdict:
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": post_text},
        ]
        structured = self._ensure()
        with telemetry.genai_span(self._model_name) as span:
            # The whole response-handling block is inside the try: an unexpected return shape (a
            # version/config mismatch) must surface as a 502 dependency_failure, not an uncaught 500.
            try:
                result = cast(dict, structured.invoke(messages))
                raw = result.get("raw")
                usage = getattr(raw, "usage_metadata", None)
                if not usage:
                    # Cost/telemetry gap, not a failure — record nothing but tell the operator.
                    _logger.warning("no usage_metadata on LLM response for %s", self._model_name)
                    usage = {}
                telemetry.record_genai_usage(
                    span,
                    response_model=self._model_name,
                    input_tokens=usage.get("input_tokens"),
                    output_tokens=usage.get("output_tokens"),
                )
                parsed = result.get("parsed")
                if not isinstance(parsed, LlmVerdict):
                    # None (a refusal/parse error) OR an unexpected type — either way there is no
                    # valid verdict. Guarding the type (not just None) keeps a malformed runnable from
                    # leaking a non-LlmVerdict downstream into a 500.
                    cause = (
                        result.get("parsing_error")
                        or f"no parsed verdict (got {type(parsed).__name__})"
                    )
                    raise _dependency_failure(
                        "llm-refusal", "LLM returned no structured output", str(cause)
                    )
                return parsed
            except ProblemError:
                raise
            except Exception as exc:
                raise _dependency_failure(
                    "llm-unavailable", "LLM provider call failed", str(exc)
                ) from exc


class LangChainEmbedder:
    """Provider-agnostic embeddings via ``init_embeddings`` (lazy, like the chat client)."""

    def __init__(self, settings: Settings, *, tokenizer: Tokenizer | None = None) -> None:
        self._settings = settings
        self._model_name = settings.moderator_embedding_model
        self._expected_dim = settings.moderator_embedding_dim
        self._max_tokens = settings.moderator_embedding_max_tokens
        # Token-aware truncation (ADR-0021): bound the input to the model's TOKEN cap, not a char count.
        # The real tokenizer builds its encoding lazily, so constructing the embedder loads no data.
        self._tokenizer = tokenizer or TiktokenTokenizer()
        self._embeddings: Embeddings | None = None
        self._lock = threading.Lock()

    @property
    def model(self) -> str:
        return self._model_name

    def _ensure(self) -> Embeddings:
        embeddings = self._embeddings
        if embeddings is None:
            with self._lock:
                embeddings = self._embeddings
                if embeddings is None:
                    from langchain.embeddings import init_embeddings

                    extra: dict[str, Any] = {}
                    if self._settings.openai_api_key:
                        extra["api_key"] = self._settings.openai_api_key
                    embeddings = init_embeddings(self._model_name, **extra)  # pyright: ignore[reportArgumentType]
                    self._embeddings = embeddings
        return embeddings

    def embed(self, text: str) -> list[float]:
        embeddings = self._ensure()
        with telemetry.genai_span(self._model_name, operation="embeddings") as span:
            try:
                bounded = self._tokenizer.truncate(text, max_tokens=self._max_tokens)
                vector = embeddings.embed_query(bounded)
            except Exception as exc:
                raise _dependency_failure(
                    "embedding-unavailable", "Embedding call failed", str(exc)
                ) from exc
            result = list(vector)
            # Bound the vector before it reaches pgvector: a malformed/oversized provider response
            # would otherwise build an unbounded text literal in knowledge.py (memory exhaustion).
            if len(result) != self._expected_dim:
                raise _dependency_failure(
                    "embedding-dimension",
                    "Embedding has an unexpected dimension",
                    f"expected {self._expected_dim} components, got {len(result)}",
                )
            telemetry.record_genai_usage(
                span, response_model=self._model_name, input_tokens=None, output_tokens=0
            )
            return result


class RuleKeywordLlm:
    """Deterministic fake: flags when the post contains a rule's trigger phrase, else allows.

    It ignores the system prompt (the real model reads it) — its only job is to drive the workflow,
    persistence, and API deterministically in unit tests.
    """

    def __init__(
        self, *, model: str = "fake-moderator-1", triggers: dict[str, list[str]] | None = None
    ) -> None:
        self._model = model
        self._triggers = triggers or {"no-harassment": ["idiot", "stupid", "slur"]}

    @property
    def model(self) -> str:
        return self._model

    def classify(self, *, system_prompt: str, post_text: str) -> LlmVerdict:
        text = post_text.lower()
        for rule_id, phrases in self._triggers.items():
            if any(phrase in text for phrase in phrases):
                return LlmVerdict(
                    disposition="remove",
                    cited_rules=[rule_id],
                    precedents=[],
                    departs_from_precedent=False,
                    rationale=f"matched rule {rule_id}",
                    confidence=0.9,
                )
        return LlmVerdict(
            disposition="approve",
            cited_rules=[],
            precedents=[],
            departs_from_precedent=False,
            rationale="no community rule matched",
            confidence=0.8,
        )


class ZeroEmbedder:
    """Deterministic fake embedder — a fixed-dimension zero vector."""

    def __init__(self, *, dim: int = 1536, model: str = "fake-embed-1") -> None:
        self._dim = dim
        self._model = model

    @property
    def model(self) -> str:
        return self._model

    def embed(self, text: str) -> list[float]:
        return [0.0] * self._dim
