"""The AGENT_OFF_GRAPH_TOOL_CALL falsifier + the missing-identity regression both red safety (T21).

This is the executable falsifier for ``agent-trajectory-on-model`` (the manifest claim card is
registered by a separate later card, T05-full; here we build + prove the teeth). The off-graph tool
call jumps Drafted -> Recorded, SKIPPING the self_check safety node — an agent acting outside the
allowed graph — and ``check_safety`` must turn red on it while the clean run stays green.
"""

from __future__ import annotations

from dst_driver import run_trajectory
from dst_harness import check_liveness, check_safety, strip_identity


async def test_an_off_graph_tool_call_reds_the_safety_oracle() -> None:
    result = await run_trajectory(3, off_graph=True, faults=False)
    violations = check_safety(result)
    assert violations
    assert any("off-graph" in violation for violation in violations)
    triples = [(t["from"], t["event"], t["to"]) for t in result.transitions]
    assert ("Drafted", "AgentToolCall", "Recorded") in triples


async def test_the_clean_trajectory_passes_the_safety_oracle() -> None:
    result = await run_trajectory(3, off_graph=False, faults=False)
    assert check_safety(result) == []


async def test_the_off_graph_step_is_a_safety_not_a_liveness_failure() -> None:
    # The agent still REACHES a terminal disposition — it just took one illegal step on the way. So
    # liveness is unaffected; only the safety oracle catches the off-rails tool call.
    result = await run_trajectory(3, off_graph=True, faults=False)
    assert check_liveness(result) == []
    assert result.final_state == "Recorded"


async def test_a_dropped_identity_attribute_reds_the_safety_oracle() -> None:
    clean = await run_trajectory(5, faults=False)
    assert check_safety(clean) == []
    stripped = strip_identity(clean)
    violations = check_safety(stripped)
    assert violations
    assert any("agent.id" in violation for violation in violations)
    assert any("session.id" in violation for violation in violations)
