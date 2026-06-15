"""Record / replay LLM seam (M14 slice). Keyless — proves the merge lane can gate the agent's
behaviour over RECORDED model output, deterministically, with no API key (the gap the key-gated
DeepEval lane leaves open). The recorder captures completions on the keyed lane; the replayer drives
the REAL workflow + self-check gates here without a model."""

from __future__ import annotations

import pytest

from helpers import make_event, make_workflow
from moderator_agent.llm import LlmClient
from moderator_agent.llm_cassette import (
    CassetteLlmClient,
    RecordingLlmClient,
    cassette_key,
)
from moderator_agent.problem import ProblemError
from moderator_agent.schemas import LlmVerdict

_HARASSMENT = "you are an idiot and a worthless troll"


class _ScriptedLlm:
    """A deterministic source whose verdict is fixed — stands in for the real model while RECORDING."""

    def __init__(self, verdict: LlmVerdict, *, model: str = "scripted-1") -> None:
        self._verdict = verdict
        self._model = model

    @property
    def model(self) -> str:
        return self._model

    def classify(self, *, system_prompt: str, post_text: str) -> LlmVerdict:
        return self._verdict


def _remove_verdict(confidence: float = 0.9) -> LlmVerdict:
    return LlmVerdict(
        disposition="remove",
        cited_rules=["no-harassment"],
        precedents=[],
        departs_from_precedent=False,
        rationale="personal attack",
        confidence=confidence,
    )


def test_recorder_and_replayer_satisfy_the_llm_client_protocol() -> None:
    recorder = RecordingLlmClient(_ScriptedLlm(_remove_verdict()))
    replayer = CassetteLlmClient({"version": 1, "model": "scripted-1", "entries": {}})
    assert isinstance(recorder, LlmClient)
    assert isinstance(replayer, LlmClient)


def test_record_then_replay_returns_the_same_verdict() -> None:
    source = _ScriptedLlm(_remove_verdict())
    recorder = RecordingLlmClient(source)
    recorded = recorder.classify(system_prompt="SYS", post_text="POST")

    replay = CassetteLlmClient(recorder.cassette())
    replayed = replay.classify(system_prompt="SYS", post_text="POST")
    assert replayed.model_dump() == recorded.model_dump()


def test_key_changes_with_the_prompt_so_a_stale_completion_is_never_served() -> None:
    a = cassette_key(model="m", system_prompt="SYS-A", post_text="POST")
    b = cassette_key(model="m", system_prompt="SYS-B", post_text="POST")
    assert a != b


def test_replay_miss_fails_loudly() -> None:
    replay = CassetteLlmClient({"version": 1, "model": "scripted-1", "entries": {}})
    with pytest.raises(ProblemError) as caught:
        replay.classify(system_prompt="SYS", post_text="unrecorded")
    assert caught.value.problem.type.endswith("/cassette-miss")


def test_unsupported_cassette_version_fails_at_load() -> None:
    with pytest.raises(ValueError):
        CassetteLlmClient({"version": 999, "model": "m", "entries": {}})


def test_save_and_from_file_roundtrips(tmp_path) -> None:
    recorder = RecordingLlmClient(_ScriptedLlm(_remove_verdict()))
    recorder.classify(system_prompt="SYS", post_text="POST")
    path = tmp_path / "cassette.json"
    recorder.save(path)

    replay = CassetteLlmClient.from_file(path)
    assert replay.classify(system_prompt="SYS", post_text="POST").disposition == "remove"


async def test_replay_drives_the_real_workflow_grounding_gate() -> None:
    """Record a removal over the real workflow, then REPLAY it through a fresh workflow: the
    deterministic self-check grounding gate runs over the recorded verdict — keyless."""
    event = make_event(title="hostile", body=_HARASSMENT)

    recorder = RecordingLlmClient(_ScriptedLlm(_remove_verdict()))
    record_wf, _, _ = make_workflow(llm=recorder)
    await record_wf.run(event)
    cassette = recorder.cassette()
    assert cassette["entries"], "the recorder must have captured the workflow's draft call"

    replay_wf, _, _ = make_workflow(llm=CassetteLlmClient(cassette))
    decision = await replay_wf.run(event)
    assert decision is not None
    assert decision.disposition == "remove"
    # Grounding holds on the replayed verdict: the cited rule was actually retrieved.
    assert list(decision.cited_rules) == ["no-harassment"]


async def test_replay_is_deterministic_across_runs() -> None:
    event = make_event(title="hostile", body=_HARASSMENT)
    recorder = RecordingLlmClient(_ScriptedLlm(_remove_verdict()))
    rec_wf, _, _ = make_workflow(llm=recorder)
    await rec_wf.run(event)
    cassette = recorder.cassette()

    first_wf, _, _ = make_workflow(llm=CassetteLlmClient(cassette))
    second_wf, _, _ = make_workflow(llm=CassetteLlmClient(cassette))
    first = await first_wf.run(event)
    second = await second_wf.run(event)
    assert first is not None and second is not None
    assert first.disposition == second.disposition
    assert list(first.cited_rules) == list(second.cited_rules)


async def test_replay_exercises_the_abstain_calibration_gate() -> None:
    """A recorded LOW-confidence removal must escalate on replay — proving the merge lane sees the
    calibration/abstain behaviour (FR5) over recorded model output, not just on the keyed lane."""
    event = make_event(title="ambiguous", body=_HARASSMENT)
    recorder = RecordingLlmClient(_ScriptedLlm(_remove_verdict(confidence=0.2)))
    rec_wf, _, _ = make_workflow(llm=recorder)
    await rec_wf.run(event)

    replay_wf, _, _ = make_workflow(llm=CassetteLlmClient(recorder.cassette()))
    decision = await replay_wf.run(event)
    assert decision is not None
    assert decision.disposition == "escalate_to_human"
