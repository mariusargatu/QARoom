"""pgvector text-literal helper, shared by the knowledge + corpus stores.

The embedding is passed as a text literal cast to ``::vector`` so no per-connection type adapter is
needed — the one place that format is defined, so the two cosine-search stores can't disagree on it.
"""

from __future__ import annotations


def vector_literal(embedding: list[float]) -> str:
    return "[" + ",".join(repr(float(x)) for x in embedding) + "]"
