"""Idempotency-Key body hashing (Commitment 4), modelled on ``packages/messaging/src/idempotency.ts``.

The body hash must be stable across JSON key ordering so that ``{"a":1,"b":2}`` and ``{"b":2,"a":1}``
collide — a client must not have to care about field order. ``stable_stringify`` sorts object keys
recursively; ``body_hash`` is the SHA-256 of that canonical form.

This cache is single-service (Python writes AND reads it; the ``/review`` route is Python-only and no
TS service computes a hash for it), so internal self-consistency is what matters and is guaranteed.
``ensure_ascii=False`` is set so the canonical form is raw UTF-8, matching TS ``JSON.stringify`` for
the string/object/null shapes a ``ReviewRequest`` body carries (it is all strings — accents, emoji and
slurs hash identically across the two languages). Number formatting is NOT reconciled with TS
(Python ``1.0`` vs TS ``1``); that is moot here because no hashed body has numeric fields, and would
need an explicit formatter if a numeric field were ever added.
"""

from __future__ import annotations

import hashlib
import json


def stable_stringify(value: object) -> str:
    """Serialize with object keys sorted recursively — the canonical form the hash is taken over."""
    if value is None or not isinstance(value, dict | list):
        return json.dumps(value, separators=(",", ":"), ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(stable_stringify(v) for v in value) + "]"
    items = sorted(value.items(), key=lambda kv: kv[0])
    return (
        "{"
        + ",".join(f"{json.dumps(k, ensure_ascii=False)}:{stable_stringify(v)}" for k, v in items)
        + "}"
    )


def body_hash(body: object) -> str:
    """SHA-256 hex digest of the stably-serialized body."""
    return hashlib.sha256(stable_stringify(body).encode("utf-8")).hexdigest()
