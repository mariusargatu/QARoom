"""Seeded fault fuzzing over the agent trajectory: safety + liveness hold across many seeds (T21).

The in-suite breadth is ``DEFAULT_SEEDS`` (200); the nightly lane widens it to ``NIGHTLY_SEEDS`` (500)
via ``MODERATOR_DST_SEEDS``. Each seed deterministically draws a fault + response variant from the
entropy buffer and drives the REAL ``ModerationWorkflow``; a healthy agent holds both invariants over
every seed. A real finding (an off-model emission, a dropped identity attr, a non-terminating run) is
persisted as ``seed + commit`` so it is replayable — it is NOT papered over.
"""

from __future__ import annotations

import os

from dst_driver import run_trajectory
from dst_harness import (
    DEFAULT_SEEDS,
    check_liveness,
    check_safety,
    persist_violation,
)


def _seed_count() -> int:
    return int(os.environ.get("MODERATOR_DST_SEEDS", str(DEFAULT_SEEDS)))


async def test_seeded_fault_fuzzing_holds_safety_and_liveness() -> None:
    results = [await run_trajectory(seed) for seed in range(_seed_count())]
    failures = [
        (result.seed, kind, violations)
        for result in results
        for kind, violations in (
            ("safety", check_safety(result)),
            ("liveness", check_liveness(result)),
        )
        if violations
    ]
    # A real finding is recorded (seed + commit) before the assertion fails — replayable, not lost.
    for seed, kind, violations in failures:
        persist_violation(seed, kind, violations)
    assert not failures, (
        f"DST safety/liveness violations (first 3 of {len(failures)}): {failures[:3]}"
    )


async def test_the_fuzz_actually_exercises_failure_and_recorded_outcomes() -> None:
    # If the sweep only ever produced clean approves, the fuzz would be vacuous. Prove it reaches both
    # terminal states and several distinct fault kinds — the invariants are tested under real variety.
    results = [await run_trajectory(seed) for seed in range(64)]
    final_states = {result.final_state for result in results}
    fault_kinds = {result.fault for result in results}
    assert "Recorded" in final_states
    assert "Failed" in final_states
    assert len(fault_kinds) >= 4


async def test_every_emitted_transition_is_attributable_to_an_agent_and_session() -> None:
    # The identity clause of safety, asserted explicitly: T05-scaff deferred these span attrs; T21 adds
    # them, so every transition the trajectory emits carries a non-empty agent.id + session.id.
    results = [await run_trajectory(seed) for seed in range(32)]
    stamped = [
        bool(transition.get("agent_id")) and bool(transition.get("session_id"))
        for result in results
        for transition in result.transitions
    ]
    assert stamped  # the sweep emitted transitions at all
    assert all(stamped)
