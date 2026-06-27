"""A planted infinite-spinner is caught via fast-forwarded virtual time (T21).

The Amp class of agent bug: a node that never signals completion (a tool retried forever after a
rejection). We plant it as an UNCAPPED backoff loop at the gather_precedent node and prove the liveness
oracle catches it — without waiting in real time, because the virtual clock fast-forwards past the
deadline. The CAPPED loop is the healthy contrast: it gives up and terminates to a Failed decision.
"""

from __future__ import annotations

from dst_driver import run_trajectory
from dst_harness import check_liveness

_DEADLINE = 30.0


async def test_a_planted_infinite_spinner_is_caught_by_the_liveness_oracle() -> None:
    result = await run_trajectory(2, spinner="uncapped", faults=False, deadline=_DEADLINE)
    assert result.livelock_detected is True
    violations = check_liveness(result)
    assert violations
    assert any("livelock" in violation for violation in violations)
    # Caught by fast-forwarding virtual time PAST the deadline — not by waiting in real wall time.
    assert result.virtual_elapsed > _DEADLINE


async def test_a_capped_backoff_terminates_within_the_deadline() -> None:
    result = await run_trajectory(2, spinner="capped", faults=False, deadline=_DEADLINE)
    assert result.livelock_detected is False
    assert result.final_state == "Failed"  # the capped retries are exhausted -> DependencyFailed
    assert check_liveness(result) == []
    assert result.virtual_elapsed <= _DEADLINE


async def test_a_normal_run_elapses_no_virtual_time_and_stays_live() -> None:
    result = await run_trajectory(2, faults=False, deadline=_DEADLINE)
    assert result.virtual_elapsed == 0.0
    assert result.final_state == "Recorded"
    assert check_liveness(result) == []
