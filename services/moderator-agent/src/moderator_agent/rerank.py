"""Two-stage retrieval: the reranker seam (ADR-0021).

Stage 1 (the ``retrieve`` node) casts a wide net by embedding-cosine — high recall, coarse order.
Stage 2 (the ``rerank`` node) narrows those candidates to the top-k the draft node actually reasons
over. Behind a ``Reranker`` Protocol it is a separately-testable, swappable component (the same
inject-everything discipline as the ``Embedder`` / ``LlmClient`` seams):

- ``LlmReranker``      — production default: the chat model scores query↔candidate relevance and
                         returns an ordering (the provider tokenizes server-side, so no tokenizer here).
- ``KeywordReranker``  — deterministic lexical overlap; drives reorder assertions with no network.
- ``IdentityReranker`` — keep the cosine order (the ``MODERATOR_DISABLE_RERANK`` fallback + test double).

Grounding guard (the retrieval-side mirror of citation grounding in ``self_check``): a reranker's
output ids MUST be a subset of its input ids. ``ground_order`` drops any id the ranker invented and
appends any candidate it omitted (so nothing is silently lost) — a misbehaving or adversarial ranker
can reorder, but it can neither fabricate policy nor make a retrieved rule disappear.

The ``reverse`` flag is the deliberate-bug toggle (``MODERATOR_RERANK_BUG``, mirroring the
``MODERATOR_PROMPT_BUG`` family): it reverses the full ranking BEFORE the top-k slice, so the most
relevant policy falls OUT of the window the LLM sees — a regression a keyword-relevance test catches.
"""

from __future__ import annotations

import logging
import re
import threading
from collections.abc import Sequence
from typing import Any, Protocol, cast, runtime_checkable

from . import telemetry
from .config import Settings
from .problem import ProblemError
from .schemas import PolicyEntry, RerankResult

_logger = logging.getLogger("qaroom.moderator.rerank")

# Lowercase alphanumeric runs — the lexical unit KeywordReranker scores overlap on.
_WORD = re.compile(r"[a-z0-9]+")


@runtime_checkable
class Reranker(Protocol):
    @property
    def name(self) -> str:
        """The reranker's identity — surfaced on telemetry, never load-bearing."""
        ...

    def rerank(
        self, query: str, entries: Sequence[PolicyEntry], *, top_k: int
    ) -> list[PolicyEntry]:
        """The top-``top_k`` of ``entries``, reordered most-relevant-to-``query`` first. Output is
        always a subset of ``entries`` (no fabricated policy) — the grounding guarantee."""
        ...


def ground_order(entries: Sequence[PolicyEntry], ordered_ids: Sequence[str]) -> list[PolicyEntry]:
    """``entries`` reordered to follow ``ordered_ids``, then every omitted candidate appended in its
    original order. Invented ids (not among ``entries``) and duplicates are dropped — so the result is
    a permutation of ``entries`` no matter what the ranker returned. NOT sliced: callers apply top_k."""
    by_id = {e.entry_id: e for e in entries}
    seen: set[str] = set()
    ordered: list[PolicyEntry] = []
    for entry_id in ordered_ids:
        entry = by_id.get(entry_id)
        if entry is not None and entry_id not in seen:
            ordered.append(entry)
            seen.add(entry_id)
    for entry in entries:
        if entry.entry_id not in seen:
            ordered.append(entry)
            seen.add(entry.entry_id)
    return ordered


def _tokens(text: str) -> set[str]:
    return set(_WORD.findall(text.lower()))


class IdentityReranker:
    """Keep stage-1 (cosine) order. The ``MODERATOR_DISABLE_RERANK`` fallback and the default test
    double — proves the seam is a no-op when reranking is off."""

    name = "identity"

    def rerank(
        self, query: str, entries: Sequence[PolicyEntry], *, top_k: int
    ) -> list[PolicyEntry]:
        return list(entries)[:top_k]


class KeywordReranker:
    """Deterministic lexical reranker — orders candidates by shared word-token overlap with the query
    (a dependency-free stand-in for a cross-encoder). Ties break on the original position, so the order
    is stable and permutation-invariant for distinct scores."""

    name = "keyword"

    def __init__(self, *, reverse: bool = False) -> None:
        # `reverse` is the deliberate-bug toggle: rank least-relevant first (see module docstring).
        self._reverse = reverse

    def rerank(
        self, query: str, entries: Sequence[PolicyEntry], *, top_k: int
    ) -> list[PolicyEntry]:
        query_tokens = _tokens(query)
        ranked = sorted(
            enumerate(entries),
            key=lambda pair: (-len(query_tokens & _tokens(pair[1].text)), pair[0]),
        )
        ordered = [entry for _, entry in ranked]
        if self._reverse:
            ordered = list(reversed(ordered))
        return ordered[:top_k]


def _dependency_failure(slug: str, title: str, cause: str) -> ProblemError:
    # Log the provider's raw error server-side; never echo it to the client (could carry request/cred
    # detail). The caller gets a generic, retryable 502 — the same posture as the LLM/embedder seam.
    _logger.error("%s: %s", slug, cause)
    return ProblemError(
        slug=slug,
        title=title,
        status=502,
        failure_domain="dependency_failure",
        detail="the reranker call failed; see service logs",
        retryable=True,
    )


_RERANK_SYSTEM = (
    "You rank a community's retrieved policy entries by how relevant each is to a specific post under "
    "review. Return ordered_ids: the entry ids, MOST relevant first. Use ONLY ids from the list below; "
    "do not invent ids and do not add commentary. Entries:"
)


def _rerank_prompt(entries: Sequence[PolicyEntry]) -> str:
    lines = [_RERANK_SYSTEM]
    lines.extend(f"- {entry.entry_id}: {entry.text}" for entry in entries)
    return "\n".join(lines)


class LlmReranker:
    """Production reranker: the chat model scores query↔candidate relevance and returns an ordering.

    Mirrors ``LangChainLlmClient`` — a lazily-built ``with_structured_output(RerankResult)`` runnable,
    a GenAI-semconv span per call, and every provider/shape failure mapped to a 502 dependency_failure.
    The structured output is grounding-guarded by ``ground_order`` before it reorders anything."""

    def __init__(self, settings: Settings, *, reverse: bool = False) -> None:
        self._settings = settings
        self._model_name = settings.moderator_model
        self._reverse = reverse
        self._structured: Any = None
        self._lock = threading.Lock()

    @property
    def name(self) -> str:
        return f"rerank:{self._model_name}"

    def _ensure(self) -> Any:
        structured = self._structured
        if structured is None:
            with self._lock:
                structured = self._structured
                if structured is None:
                    from langchain.chat_models import init_chat_model

                    extra: dict[str, Any] = {}
                    if self._settings.openai_api_key:
                        extra["api_key"] = self._settings.openai_api_key
                    if self._settings.moderator_reasoning_effort:
                        extra["reasoning_effort"] = self._settings.moderator_reasoning_effort
                    model = init_chat_model(self._model_name, **extra)  # pyright: ignore[reportArgumentType]
                    structured = model.with_structured_output(RerankResult)
                    self._structured = structured
        return structured

    def rerank(
        self, query: str, entries: Sequence[PolicyEntry], *, top_k: int
    ) -> list[PolicyEntry]:
        if not entries:
            return []
        structured = self._ensure()
        messages = [
            {"role": "system", "content": _rerank_prompt(entries)},
            {"role": "user", "content": query},
        ]
        with telemetry.genai_span(self._model_name, operation="rerank") as span:
            try:
                parsed = cast(object, structured.invoke(messages))
                if not isinstance(parsed, RerankResult):
                    raise _dependency_failure(
                        "rerank-refusal",
                        "Reranker returned no structured ordering",
                        f"got {type(parsed).__name__}",
                    )
                telemetry.record_genai_usage(
                    span, response_model=self._model_name, input_tokens=None, output_tokens=None
                )
                ordered_ids = parsed.ordered_ids
            except ProblemError:
                raise
            except Exception as exc:
                raise _dependency_failure(
                    "rerank-unavailable", "Reranker call failed", str(exc)
                ) from exc
        ordered = ground_order(entries, ordered_ids)
        if self._reverse:
            ordered = list(reversed(ordered))
        return ordered[:top_k]
