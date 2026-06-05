"""Determinism trio (Commitment 6), Python edition.

Every QARoom service — TypeScript or Python — reads time, ids, and randomness through injected
interfaces, never globals. Production wires the real implementations; tests wire seeded doubles, so
a moderation run is reproducible. The LLM is the one genuinely stochastic dependency; it is pinned
(`temperature=0`, `seed`) and injected like everything else (see ``llm.py``). A full record/replay
``ModelClient`` seam is deferred to Milestone 14 (ADR-0018); here the LLM is plain DI so unit tests
stay deterministic without a network call.
"""

from __future__ import annotations

import datetime as _dt
import random as _random
from typing import Protocol, runtime_checkable

from ulid import ULID

# Crockford base32 alphabet (no I, L, O, U) — the ULID body alphabet the branded-id regex accepts.
_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


@runtime_checkable
class Clock(Protocol):
    def now(self) -> _dt.datetime: ...


@runtime_checkable
class IdGenerator(Protocol):
    def next(self, prefix: str) -> str: ...


@runtime_checkable
class Randomness(Protocol):
    def next(self) -> float: ...
    def randint(self, lo: int, hi: int) -> int: ...


class SystemClock:
    """Production clock — UTC wall time."""

    def now(self) -> _dt.datetime:
        return _dt.datetime.now(_dt.UTC)


class UlidIdGenerator:
    """Production id generator — ``<prefix>_<ULID>`` (Crockford base32, 26 chars)."""

    def next(self, prefix: str) -> str:
        return f"{prefix}_{ULID()!s}"


class CryptoRandomness:
    """Production randomness — OS CSPRNG."""

    def __init__(self) -> None:
        self._r = _random.SystemRandom()

    def next(self) -> float:
        return self._r.random()

    def randint(self, lo: int, hi: int) -> int:
        return self._r.randint(lo, hi)


class FixedClock:
    """Seeded clock — returns one instant until advanced. Mirrors the TS FixedClock used in replay."""

    def __init__(self, instant: _dt.datetime) -> None:
        self._instant = instant

    def now(self) -> _dt.datetime:
        return self._instant

    def set(self, instant: _dt.datetime) -> None:
        self._instant = instant

    def advance(self, **delta: float) -> None:
        self._instant = self._instant + _dt.timedelta(**delta)


def _encode_crockford(n: int, length: int = 26) -> str:
    chars: list[str] = []
    for _ in range(length):
        n, rem = divmod(n, 32)
        chars.append(_CROCKFORD[rem])
    return "".join(reversed(chars))


class SeededIdGenerator:
    """Seeded id generator — a monotonic counter encoded as a 26-char Crockford body."""

    def __init__(self, start: int = 0) -> None:
        self._counter = start

    def next(self, prefix: str) -> str:
        self._counter += 1
        return f"{prefix}_{_encode_crockford(self._counter)}"


class SeededRandomness:
    """Seeded randomness — a deterministic PRNG."""

    def __init__(self, seed: int = 0) -> None:
        self._r = _random.Random(seed)

    def next(self) -> float:
        return self._r.random()

    def randint(self, lo: int, hi: int) -> int:
        return self._r.randint(lo, hi)


def production_trio() -> tuple[Clock, IdGenerator, Randomness]:
    return SystemClock(), UlidIdGenerator(), CryptoRandomness()


def seeded_trio(
    *, seed: int = 0, instant: _dt.datetime | None = None
) -> tuple[Clock, IdGenerator, Randomness]:
    when = instant or _dt.datetime(2026, 1, 1, tzinfo=_dt.UTC)
    return FixedClock(when), SeededIdGenerator(), SeededRandomness(seed)
