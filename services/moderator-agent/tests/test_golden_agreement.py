from typing import cast

import pytest

from moderator_agent.golden.agreement import fleiss_kappa, interpret_kappa
from moderator_agent.golden.build import build_dataset, to_promptfoo_tests
from moderator_agent.golden.schema import Candidate, SmeLabel, Verdict


def test_fleiss_is_one_when_every_item_is_unanimous() -> None:
    # Two items, each unanimous but in different categories → perfect agreement.
    assert fleiss_kappa([[3, 0], [0, 3]]) == pytest.approx(1.0)


def test_fleiss_is_negative_for_uniform_splits() -> None:
    # Every item split 2:1 the same way → worse than chance.
    assert fleiss_kappa([[2, 1], [2, 1], [2, 1]]) < 0


def test_fleiss_handles_degenerate_inputs() -> None:
    assert fleiss_kappa([]) == 0.0
    assert fleiss_kappa([[1, 0]]) == 0.0  # a single rater


@pytest.mark.parametrize(
    ("kappa", "band"),
    [
        (-0.1, "poor"),
        (0.1, "slight"),
        (0.3, "fair"),
        (0.5, "moderate"),
        (0.7, "substantial"),
        (0.9, "almost perfect"),
    ],
)
def test_landis_koch_bands(kappa: float, band: str) -> None:
    assert interpret_kappa(kappa) == band


def _labels(candidate_id: str, verdicts: list[str]) -> list[SmeLabel]:
    return [
        SmeLabel(
            candidate_id=candidate_id, sme_id=f"sme_{i}", verdict=cast(Verdict, v), rule_id=None
        )
        for i, v in enumerate(verdicts)
    ]


def test_build_gates_unanimous_as_gold_and_splits_as_ambiguous() -> None:
    candidates = [Candidate(id="cand_a", post="..."), Candidate(id="cand_b", post="...")]
    labels = _labels("cand_a", ["flag", "flag", "flag"]) + _labels(
        "cand_b", ["allow", "allow", "flag"]
    )
    dataset = build_dataset(candidates, labels)

    assert dataset.n_raters == 3
    assert dataset.n_items == 2
    by_id = {case.id: case for case in dataset.cases}
    assert by_id["cand_a"].status == "gold"
    assert by_id["cand_a"].gold_verdict == "flag"
    assert by_id["cand_b"].status == "ambiguous"  # a 2:1 split never becomes gold
    assert by_id["cand_b"].gold_verdict == "allow"  # majority is still recorded
    assert dataset.n_gold == 1


def test_promptfoo_tests_include_only_gold_cases_plus_the_injection_case() -> None:
    candidates = [Candidate(id="cand_a", post="x"), Candidate(id="cand_b", post="y")]
    labels = _labels("cand_a", ["flag", "flag", "flag"]) + _labels(
        "cand_b", ["allow", "allow", "flag"]
    )
    tests = to_promptfoo_tests(build_dataset(candidates, labels))
    # one gold case + the appended injection case
    assert len(tests) == 2
    assert any("injection" in t["description"] for t in tests)
    assert any("cand_a" in t.get("description", "") for t in tests)
    assert not any("cand_b" in t.get("description", "") for t in tests)
