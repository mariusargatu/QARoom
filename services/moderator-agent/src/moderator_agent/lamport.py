"""LamportGate (Commitment 7), Python mirror of ``packages/contracts/src/lamport.ts``.

A monotonic per-service counter that every mutating path bumps after it commits, so a ``/system``
read can pin its result with an ``as_of`` envelope ``{snapshot_id, lamport, wall_clock}``. The
moderator bumps on every recorded decision. ``restore`` exists for scenario replay only.
"""

from __future__ import annotations

from dataclasses import dataclass

from .determinism import Clock, IdGenerator


@dataclass(frozen=True)
class LamportTick:
    lamport: int
    snapshot_id: str


@dataclass(frozen=True)
class AsOf:
    snapshot_id: str
    lamport: int
    wall_clock: str


class LamportGate:
    def __init__(self, ids: IdGenerator) -> None:
        self._counter = 0
        self._ids = ids

    def bump(self) -> LamportTick:
        self._counter += 1
        return LamportTick(self._counter, self._ids.next("snap"))

    def read(self) -> LamportTick:
        return LamportTick(self._counter, self._ids.next("snap"))

    @property
    def value(self) -> int:
        return self._counter

    def restore(self, counter: int) -> None:
        self._counter = counter


def as_of(clock: Clock, lamport: LamportGate) -> AsOf:
    tick = lamport.read()
    return AsOf(
        snapshot_id=tick.snapshot_id,
        lamport=tick.lamport,
        wall_clock=clock.now().isoformat().replace("+00:00", "Z"),
    )
