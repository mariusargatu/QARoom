"""Replay: same seed -> identical trajectory; a violation persists ``seed + commit`` (T21)."""

from __future__ import annotations

import json

from dst_driver import run_trajectory
from dst_harness import persist_violation


async def test_the_same_seed_replays_a_byte_identical_trajectory() -> None:
    first = await run_trajectory(7)
    second = await run_trajectory(7)
    assert first.transitions == second.transitions
    assert first.disposition == second.disposition
    assert first.final_state == second.final_state
    assert first.fault == second.fault


async def test_distinct_seeds_diverge_so_the_entropy_buffer_is_load_bearing() -> None:
    results = [await run_trajectory(seed) for seed in range(32)]
    outcomes = {(result.fault, result.final_state, result.disposition) for result in results}
    assert len(outcomes) > 1


def test_persist_violation_records_the_replayable_seed_and_commit(tmp_path) -> None:
    path = tmp_path / "dst-violations.jsonl"
    persist_violation(
        123,
        "safety",
        ["off-graph transition ('Drafted', 'AgentToolCall', 'Recorded')"],
        path=path,
        commit="deadbeef",
    )
    persist_violation(
        124, "liveness", ["livelock: spun past the deadline"], path=path, commit="deadbeef"
    )
    lines = path.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 2
    first = json.loads(lines[0])
    assert first["seed"] == 123
    assert first["commit"] == "deadbeef"
    assert first["kind"] == "safety"
    assert first["violations"] == ["off-graph transition ('Drafted', 'AgentToolCall', 'Recorded')"]
