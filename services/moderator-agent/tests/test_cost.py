from moderator_agent.cost import CostAccumulator, load_cost_model, usd_for_tokens
from moderator_agent.cost_ledger import build_ledger


def test_usd_is_computed_from_the_vendored_per_million_rates() -> None:
    prices = {"openai:demo": {"input_per_1m": 2.0, "output_per_1m": 10.0}}
    # 1M input @ $2 + 0.5M output @ $10 = 2 + 5 = 7
    assert usd_for_tokens("openai:demo", 1_000_000, 500_000, prices) == 7.0


def test_unknown_model_costs_zero_rather_than_raising() -> None:
    # A missing price is a telemetry gap, not a run failure (mirrors llm.py's usage-metadata stance).
    assert usd_for_tokens("openai:not-priced", 1000, 1000, {}) == 0.0


def test_real_model_has_a_vendored_price() -> None:
    prices = load_cost_model()["prices"]
    assert "openai:text-embedding-3-small" in prices


def test_accumulator_sums_measured_usage_and_tolerates_none() -> None:
    acc = CostAccumulator(model="openai:demo")
    acc.add(100, 50)
    acc.add(None, 10)  # a call with no usage_metadata must not crash the accumulator
    assert acc.input_tokens == 100
    assert acc.output_tokens == 60
    assert acc.calls == 2


def test_ledger_is_pure_and_stamps_the_injected_timestamp() -> None:
    ledger = build_ledger("2026-06-13T12:00:00Z", "abc1234")
    assert ledger["generated_at"] == "2026-06-13T12:00:00Z"
    assert ledger["commit"] == "abc1234"
    assert ledger["total_tokens"] > 0
    assert ledger["basis"] == "estimate"
    assert {lane["name"] for lane in ledger["lanes"]} == {
        "gold-deepeval",
        "deepteam-owasp",
        "pyrit-nightly",
    }
