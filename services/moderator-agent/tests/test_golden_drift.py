from pathlib import Path

from moderator_agent.golden.build import (
    build_dataset,
    load_candidates,
    load_labels,
    render_gold_json,
    render_promptfoo_tests,
)

_GOLD = Path(__file__).resolve().parents[1] / "evals" / "golden"


def _dataset():
    return build_dataset(load_candidates(), load_labels())


def test_committed_gold_matches_the_labels() -> None:
    assert (_GOLD / "gold.json").read_text() == render_gold_json(_dataset()), (
        "run `pnpm --filter @qaroom/moderator-agent golden:build`"
    )


def test_committed_promptfoo_tests_match_the_gold() -> None:
    assert (_GOLD / "promptfoo-tests.yaml").read_text() == render_promptfoo_tests(_dataset())


def test_kappa_is_at_least_substantial() -> None:
    # A gold set is only a trustworthy oracle if the SMEs actually agreed (Landis-Koch >= 0.6).
    assert _dataset().fleiss_kappa_verdict >= 0.6


def test_every_gold_case_is_unanimous_and_ambiguous_cases_are_held_out() -> None:
    dataset = _dataset()
    assert dataset.n_gold > 0
    for case in dataset.cases:
        if case.status == "gold":
            assert case.unanimous
        else:
            assert not case.unanimous  # a split never becomes gold
