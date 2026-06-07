"""Token-aware truncation seam (ADR-0021) — tokenization split out of the embedder.

The embedder MUST bound its input to the embedding model's TOKEN limit, not a char count:
``text-embedding-3-small`` caps at 8191 tokens, and chars are a poor proxy (CJK or code-dense text
packs far more tokens per char than English prose). Pre-this-change the embedder truncated by chars
(``text[: max_chars]``), which could overrun the token cap on dense input or waste budget on sparse
input — a latent correctness bug.

Splitting tokenization behind a ``Tokenizer`` Protocol makes it an injected, separately-testable
component (the same inject-everything discipline as the ``Embedder`` / ``LlmClient`` seams):
production wires ``TiktokenTokenizer`` (the encoding the OpenAI models use); the deterministic unit
suite wires ``WordTokenizer`` (whitespace tokens — no network, no model download, exact counts).
"""

from __future__ import annotations

import re
import threading
from typing import Any, Protocol, runtime_checkable

# A run of non-whitespace = one word token. Deterministic and dependency-free — the unit-test fake.
_WORD = re.compile(r"\S+")


@runtime_checkable
class Tokenizer(Protocol):
    @property
    def name(self) -> str:
        """The encoding/scheme name — surfaced on telemetry, never load-bearing."""
        ...

    def count(self, text: str) -> int:
        """How many tokens ``text`` encodes to."""
        ...

    def truncate(self, text: str, *, max_tokens: int) -> str:
        """``text`` bounded to at most ``max_tokens`` tokens (``max_tokens <= 0`` → empty)."""
        ...


class WordTokenizer:
    """Deterministic fake — one token per whitespace-delimited run. ``truncate`` returns a true prefix
    of the input (cut right after the Nth word), so ``count(truncate(t, n)) == min(count(t), n)``."""

    name = "word"

    def count(self, text: str) -> int:
        return len(_WORD.findall(text))

    def truncate(self, text: str, *, max_tokens: int) -> str:
        if max_tokens <= 0:
            return ""
        matches = list(_WORD.finditer(text))
        if len(matches) <= max_tokens:
            return text
        # Cut at the end of the max_tokens-th word: a real character prefix, no trailing whitespace.
        return text[: matches[max_tokens - 1].end()]


class TiktokenTokenizer:
    """Production tokenizer over an OpenAI ``tiktoken`` encoding (``cl100k_base`` is what the
    ``text-embedding-3-*`` and gpt-4-class models use). The encoding is built lazily under a lock — the
    first ``count``/``truncate`` loads it, like the lazy LLM/embeddings clients — so importing this
    module never reaches for the encoding data."""

    def __init__(self, *, encoding: str = "cl100k_base") -> None:
        self._encoding_name = encoding
        # The tiktoken Encoding (typed Any — tiktoken is imported lazily, so no import-time dependency).
        self._enc: Any = None
        self._lock = threading.Lock()

    @property
    def name(self) -> str:
        return self._encoding_name

    def _ensure(self) -> Any:
        enc = self._enc
        if enc is None:
            with self._lock:
                enc = self._enc
                if enc is None:
                    import tiktoken

                    enc = tiktoken.get_encoding(self._encoding_name)
                    self._enc = enc
        return enc

    def count(self, text: str) -> int:
        return len(self._ensure().encode(text))

    def truncate(self, text: str, *, max_tokens: int) -> str:
        if max_tokens <= 0:
            return ""
        enc = self._ensure()
        ids = enc.encode(text)
        if len(ids) <= max_tokens:
            return text
        return enc.decode(ids[:max_tokens])
