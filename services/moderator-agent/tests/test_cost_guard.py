from moderator_agent.config import Settings
from moderator_agent.eval_cost_guard import estimate_tokens


def test_estimate_is_positive_and_under_the_default_budget() -> None:
    estimate = estimate_tokens()
    assert estimate > 0
    assert estimate < Settings().moderator_eval_budget_tokens


def test_estimate_scales_with_the_golden_set() -> None:
    # The golden set is small; a sane pre-flight estimate is well under 100k tokens.
    assert estimate_tokens() < 100_000
