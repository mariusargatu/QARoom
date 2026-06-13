from moderator_agent.config import Settings
from moderator_agent.cost import estimate_lanes, load_cost_model
from moderator_agent.eval_cost_guard import _gold_inputs


def _lanes():
    system_chars, posts = _gold_inputs()
    return estimate_lanes(Settings().moderator_model, system_chars, posts, load_cost_model())


def test_total_estimate_is_positive_and_under_the_default_budget() -> None:
    total = sum(lane.tokens for lane in _lanes())
    assert total > 0
    assert total < Settings().moderator_eval_budget_tokens


def test_every_lane_including_the_red_team_lanes_is_estimated() -> None:
    # The old estimate sized only the gold set; the red-team lanes that were the real uncapped
    # cost (DeepTeam, PyRIT) must now be in the ceiling.
    names = {lane.name for lane in _lanes()}
    assert names == {"gold-deepeval", "deepteam-owasp", "pyrit-nightly"}


def test_pyrit_multiturn_is_the_token_heaviest_lane() -> None:
    lanes = {lane.name: lane.tokens for lane in _lanes()}
    assert lanes["pyrit-nightly"] > lanes["deepteam-owasp"]
