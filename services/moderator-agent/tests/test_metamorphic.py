import os
from pathlib import Path

import pytest

from moderator_agent.metamorphic import GOLDEN_CASES, check_paraphrase_invariance
from moderator_agent.schemas import LlmVerdict


def _approve() -> LlmVerdict:
    return LlmVerdict(disposition="approve", rationale="ok", confidence=0.8)


def _remove() -> LlmVerdict:
    return LlmVerdict(
        disposition="remove", cited_rules=["r"], rationale="violation", confidence=0.9
    )


def test_the_checker_catches_a_phrasing_sensitive_classifier() -> None:
    """A classifier that only recognises the canonical wording (the deliberate prompt-bug shape)
    breaks paraphrase invariance — and the metamorphic checker must catch it."""
    removed_literals = {
        case.canonical for case in GOLDEN_CASES if case.expected_disposition == "remove"
    }

    def literal_only(text: str) -> LlmVerdict:
        return _remove() if text in removed_literals else _approve()

    violations = check_paraphrase_invariance(literal_only, GOLDEN_CASES)
    assert violations
    assert any(v.case.startswith("harassment") for v in violations)


def test_the_recorded_real_model_is_paraphrase_invariant() -> None:
    """The REAL model's recorded verdicts satisfy paraphrase invariance — replayed KEYLESSLY on every
    PR from the committed cassette (tests/cassettes/metamorphic.json), captured on the keyed lane by
    scripts/record_metamorphic_cassette.py. This is the actual oracle the keyword-stem test below only
    simulates: it drives ``check_paraphrase_invariance`` over genuine model output, not a stand-in. A
    prompt/corpus/model change misses the cassette and fails LOUDLY (re-record), never a silent pass."""
    from moderator_agent.config import Settings
    from moderator_agent.llm_cassette import CassetteLlmClient
    from moderator_agent.persistence.rules_seed import load_corpus_dir
    from moderator_agent.workflow.prompts import build_system_prompt

    root = Path(__file__).resolve().parents[1]
    entries = load_corpus_dir(root / "rules").get("comm_" + "0" * 26, [])
    prompt = build_system_prompt(entries, [], prompt_bug=Settings().moderator_prompt_bug)
    cassette = CassetteLlmClient.from_file(root / "tests" / "cassettes" / "metamorphic.json")

    def classify(text: str) -> LlmVerdict:
        return cassette.classify(system_prompt=prompt, post_text=text)

    assert check_paraphrase_invariance(classify, GOLDEN_CASES) == []


def test_the_checker_passes_a_semantic_classifier() -> None:
    """A unit test of the CHECKER (not the model): a classifier that judges meaning gives one
    disposition per family, so ``check_paraphrase_invariance`` reports nothing. The real-model oracle is
    ``test_the_recorded_real_model_is_paraphrase_invariant`` above; this only proves the checker itself
    doesn't false-positive on a semantically-consistent classifier."""
    stems = [
        "idiot",
        "worthless",
        "hopeless",
        "unwanted",
        "hate",
        "follower",
        "boost",
        "cheap",
        "discounted",
    ]

    def semantic(text: str) -> LlmVerdict:
        lowered = text.lower()
        return _remove() if any(stem in lowered for stem in stems) else _approve()

    assert check_paraphrase_invariance(semantic, GOLDEN_CASES) == []


@pytest.mark.llm
@pytest.mark.skipif(
    not os.environ.get("OPENAI_API_KEY"),
    reason="needs OPENAI_API_KEY (roadmap-literal real-OpenAI evals, ADR-0017)",
)
def test_the_real_model_is_paraphrase_invariant() -> None:
    """The actual agent must give a paraphrase the same verdict as its canonical. With
    MODERATOR_PROMPT_BUG=1 this fails (the deliberate-bug demo); with the honest prompt it passes."""
    from moderator_agent.config import Settings
    from moderator_agent.llm import LangChainLlmClient
    from moderator_agent.persistence.rules_seed import load_corpus_dir
    from moderator_agent.workflow.prompts import build_system_prompt

    settings = Settings()
    llm = LangChainLlmClient(settings)
    entries = load_corpus_dir(Path(__file__).resolve().parents[1] / "rules").get(
        "comm_" + "0" * 26, []
    )
    prompt = build_system_prompt(entries, [], prompt_bug=settings.moderator_prompt_bug)

    def classify(text: str) -> LlmVerdict:
        return llm.classify(system_prompt=prompt, post_text=text)

    assert check_paraphrase_invariance(classify, GOLDEN_CASES) == []
