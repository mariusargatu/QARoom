"""The reranker seam (ADR-0021), in isolation.

Deterministic throughout: ``KeywordReranker`` / ``IdentityReranker`` / ``ground_order`` need no
network, and ``LlmReranker``'s parse + grounding + error mapping are exercised by injecting a fake
structured runnable (the ``test_llm`` pattern) — the real provider stays out of the unit suite.

Covered: ordering by relevance, top-k slicing, the grounding guarantee (output ⊆ input, nothing
fabricated or lost), two metamorphic invariants (permutation-invariance; an irrelevant doc does not
reorder the relevant ones), and the deliberate-bug demo (a reversed ranker drops the relevant policy
out of the top-k window — the regression a keyword-relevance test must catch).
"""

from __future__ import annotations

import pytest

from moderator_agent.config import Settings
from moderator_agent.problem import ProblemError
from moderator_agent.rerank import (
    IdentityReranker,
    KeywordReranker,
    LlmReranker,
    ground_order,
)
from moderator_agent.schemas import PolicyEntry, RerankResult

HARASS = PolicyEntry(
    entry_id="no-harassment", entry_type="rule", text="harassment personal attack slur"
)
SPAM = PolicyEntry(entry_id="no-spam", entry_type="rule", text="spam personal attack")
OFFTOPIC = PolicyEntry(entry_id="stay-on-topic", entry_type="guideline", text="topic harassment")
IRRELEVANT = PolicyEntry(entry_id="irrelevant", entry_type="rule", text="weather sports cooking")

# Distinct overlap scores: harassment=4, spam=2, off-topic=1 — a strict, tie-free relevance order.
QUERY = "this is a personal attack and harassment with a slur"
CANDIDATES = [
    OFFTOPIC,
    SPAM,
    HARASS,
]  # deliberately NOT relevance order, so a reorder is observable


def _ids(entries: list[PolicyEntry]) -> list[str]:
    return [entry.entry_id for entry in entries]


# --- IdentityReranker: the no-op fallback ---


def test_identity_preserves_order_and_slices_top_k() -> None:
    out = IdentityReranker().rerank(QUERY, CANDIDATES, top_k=2)
    assert _ids(out) == ["stay-on-topic", "no-spam"]


# --- KeywordReranker: relevance ordering ---


def test_keyword_ranks_the_most_relevant_entry_first() -> None:
    out = KeywordReranker().rerank(QUERY, CANDIDATES, top_k=3)
    assert _ids(out) == ["no-harassment", "no-spam", "stay-on-topic"]


def test_keyword_top_k_keeps_only_the_most_relevant() -> None:
    out = KeywordReranker().rerank(QUERY, CANDIDATES, top_k=1)
    assert _ids(out) == ["no-harassment"]


@pytest.mark.parametrize(
    "permutation",
    [
        [HARASS, SPAM, OFFTOPIC],
        [OFFTOPIC, HARASS, SPAM],
        [SPAM, OFFTOPIC, HARASS],
    ],
)
def test_keyword_is_permutation_invariant_for_distinct_scores(
    permutation: list[PolicyEntry],
) -> None:
    # Metamorphic: the input order must not affect the ranked output when scores are distinct.
    out = KeywordReranker().rerank(QUERY, permutation, top_k=3)
    assert _ids(out) == ["no-harassment", "no-spam", "stay-on-topic"]


def test_keyword_an_irrelevant_doc_does_not_reorder_the_relevant_ones() -> None:
    # Metamorphic: adding a zero-overlap candidate leaves the relevant ordering intact (it sinks last).
    out = KeywordReranker().rerank(QUERY, [*CANDIDATES, IRRELEVANT], top_k=4)
    assert _ids(out) == ["no-harassment", "no-spam", "stay-on-topic", "irrelevant"]


# --- The deliberate-bug demo: a reversed ranker drops the relevant policy out of top-k ---


def test_keyword_honest_selects_the_relevant_rule_into_top_1() -> None:
    out = KeywordReranker(reverse=False).rerank(QUERY, CANDIDATES, top_k=1)
    assert _ids(out) == ["no-harassment"]


def test_keyword_rerank_bug_drops_the_relevant_rule_out_of_top_1() -> None:
    # MODERATOR_RERANK_BUG: least-relevant first → the harassment rule the post violates is no longer
    # in the single entry the LLM would see. This is the teeth a keyword-relevance test gives the gate.
    out = KeywordReranker(reverse=True).rerank(QUERY, CANDIDATES, top_k=1)
    assert _ids(out) == ["stay-on-topic"]
    assert "no-harassment" not in _ids(out)


# --- ground_order: the grounding guarantee ---


def test_ground_order_follows_the_ids_then_appends_the_omitted() -> None:
    out = ground_order(CANDIDATES, ["no-harassment", "no-spam"])
    # off-topic was omitted by the ranker → appended in its original position, never lost.
    assert _ids(out) == ["no-harassment", "no-spam", "stay-on-topic"]


def test_ground_order_drops_a_fabricated_id() -> None:
    out = ground_order(CANDIDATES, ["does-not-exist", "no-spam"])
    assert _ids(out) == ["no-spam", "stay-on-topic", "no-harassment"]
    assert "does-not-exist" not in _ids(out)


def test_ground_order_drops_duplicate_ids() -> None:
    out = ground_order(CANDIDATES, ["no-spam", "no-spam"])
    assert _ids(out) == ["no-spam", "stay-on-topic", "no-harassment"]


def test_ground_order_output_is_a_permutation_of_the_input() -> None:
    out = ground_order(CANDIDATES, ["irrelevant", "no-spam"])
    assert sorted(_ids(out)) == sorted(_ids(CANDIDATES))


# --- LlmReranker: parse + grounding + error mapping, via an injected fake runnable ---


class _FixedRerank:
    def __init__(self, result: object) -> None:
        self._result = result

    def invoke(self, messages: object) -> object:
        return self._result


class _RaisingRerank:
    def invoke(self, messages: object) -> object:
        raise RuntimeError("rerank provider down")


def _reranker_with(structured: object, *, reverse: bool = False) -> LlmReranker:
    reranker = LlmReranker(Settings(), reverse=reverse)
    reranker._structured = structured
    return reranker


def test_llm_reranker_orders_by_the_models_ids() -> None:
    fake = _FixedRerank(RerankResult(ordered_ids=["no-harassment", "no-spam"]))
    out = _reranker_with(fake).rerank(QUERY, CANDIDATES, top_k=3)
    assert _ids(out) == ["no-harassment", "no-spam", "stay-on-topic"]


def test_llm_reranker_grounds_a_fabricated_id_out() -> None:
    # An adversarial / hallucinated id cannot inject policy that was not retrieved.
    fake = _FixedRerank(RerankResult(ordered_ids=["ghost-rule", "no-spam"]))
    out = _reranker_with(fake).rerank(QUERY, CANDIDATES, top_k=3)
    assert "ghost-rule" not in _ids(out)
    assert sorted(_ids(out)) == sorted(_ids(CANDIDATES))


def test_llm_reranker_empty_candidates_short_circuits() -> None:
    out = _reranker_with(_RaisingRerank()).rerank(QUERY, [], top_k=3)
    assert out == []


def test_llm_reranker_maps_a_provider_error_to_502() -> None:
    with pytest.raises(ProblemError) as ei:
        _reranker_with(_RaisingRerank()).rerank(QUERY, CANDIDATES, top_k=3)
    assert ei.value.problem.status == 502
    assert ei.value.problem.failure_domain == "dependency_failure"


def test_llm_reranker_maps_an_unparseable_output_to_502() -> None:
    with pytest.raises(ProblemError) as ei:
        _reranker_with(_FixedRerank(None)).rerank(QUERY, CANDIDATES, top_k=3)
    assert ei.value.problem.status == 502


def test_llm_reranker_bug_reverses_into_least_relevant() -> None:
    fake = _FixedRerank(RerankResult(ordered_ids=["no-harassment", "no-spam", "stay-on-topic"]))
    out = _reranker_with(fake, reverse=True).rerank(QUERY, CANDIDATES, top_k=1)
    assert _ids(out) == ["stay-on-topic"]
