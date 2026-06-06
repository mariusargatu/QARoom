"""The workflow must thread the model's disposition straight through to the recorded decision — for
every SME-gold case. A scripted (deterministic) LLM stands in for the real model: this exercises the
record/plumbing path over both approve and remove dispositions drawn from the real gold dataset,
without a network call. (The real model's accuracy is the DeepEval eval's job; this is pure plumbing.)

The gold dataset's SME labels are binary (``allow``/``flag``); they map to the agent's dispositions
``approve``/``remove`` (escalate is the abstain path, evaluated separately). A high-confidence
``remove`` cites a grounded rule so self-check passes it through rather than escalating an ungrounded
removal (FR5)."""

import json
from pathlib import Path

import pytest

from helpers import make_event, make_workflow
from moderator_agent.schemas import LlmVerdict

_GOLD = json.loads(
    (Path(__file__).resolve().parents[1] / "evals" / "golden" / "gold.json").read_text()
)
_GOLD_CASES = [c for c in _GOLD["cases"] if c["status"] == "gold"]
_DISPOSITION = {"allow": "approve", "flag": "remove"}


class _ScriptedLlm:
    """Returns one fixed verdict regardless of prompt — the deterministic stand-in for the real model."""

    model = "scripted-gold-1"

    def __init__(self, verdict: LlmVerdict) -> None:
        self._verdict = verdict

    def classify(self, *, system_prompt: str, post_text: str) -> LlmVerdict:
        return self._verdict


@pytest.mark.parametrize("case", _GOLD_CASES, ids=[c["id"] for c in _GOLD_CASES])
async def test_the_workflow_records_each_gold_disposition(case: dict) -> None:
    expected = _DISPOSITION[case["gold_verdict"]]
    cited = [] if expected == "approve" else ["no-harassment"]  # grounded in the default corpus
    scripted = LlmVerdict.model_validate(
        {"disposition": expected, "cited_rules": cited, "rationale": "scripted gold", "confidence": 0.99}
    )
    workflow, decisions, _ = make_workflow(llm=_ScriptedLlm(scripted))
    decision = await workflow.run(make_event(body=case["post"]))
    assert decision is not None
    assert decision.disposition == expected
    assert workflow.last_state == "Recorded"
    assert await decisions.count() == 1
