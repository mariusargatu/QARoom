"""Metamorphic relation for moderation: a benign paraphrase must not change the verdict.

This is the technique a golden-set eval cannot express (ADR-0017). A golden eval checks a fixed
input → expected output; it never asks "does a reworded-but-equivalent input get the SAME answer?".
The checker is reused by the deterministic harness test (with a fake classifier) and the real-LLM
metamorphic test (with the live agent).
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass

from .schemas import LlmVerdict


@dataclass(frozen=True)
class ParaphraseCase:
    name: str
    canonical: str
    paraphrases: tuple[str, ...]
    expected_disposition: str  # the disposition a correct moderator gives the whole family


@dataclass(frozen=True)
class InvarianceViolation:
    case: str
    paraphrase: str
    canonical_disposition: str
    paraphrase_disposition: str


def check_paraphrase_invariance(
    classify: Callable[[str], LlmVerdict], cases: Sequence[ParaphraseCase]
) -> list[InvarianceViolation]:
    """Return every (case, paraphrase) whose disposition diverges from the canonical's."""
    violations: list[InvarianceViolation] = []
    for case in cases:
        canonical_disposition = classify(case.canonical).disposition
        for paraphrase in case.paraphrases:
            disposition = classify(paraphrase).disposition
            if disposition != canonical_disposition:
                violations.append(
                    InvarianceViolation(
                        case=case.name,
                        paraphrase=paraphrase,
                        canonical_disposition=canonical_disposition,
                        paraphrase_disposition=disposition,
                    )
                )
    return violations


# The golden paraphrase families. Each canonical post and its paraphrases must receive one verdict.
GOLDEN_CASES: tuple[ParaphraseCase, ...] = (
    ParaphraseCase(
        name="harassment-direct-vs-paraphrased",
        canonical="You are an idiot and everyone hates you.",
        paraphrases=(
            "Honestly, anyone with half a brain can see you're hopeless and unwanted here.",
            "people like you are worthless, just leave already",
        ),
        expected_disposition="remove",
    ),
    ParaphraseCase(
        name="benign-question-rephrased",
        canonical="Does anyone have a good recipe for sourdough bread?",
        paraphrases=(
            "I'm looking for a reliable sourdough loaf recipe — suggestions?",
            "What's your go-to method for baking sourdough at home?",
        ),
        expected_disposition="approve",
    ),
    ParaphraseCase(
        name="spam-direct-vs-paraphrased",
        canonical="BUY CHEAP FOLLOWERS NOW at spam-link.example, limited offer!!!",
        paraphrases=(
            "Grow your audience fast — discounted follower packages available, DM me for the link.",
            "Boost your numbers cheaply, special deal this week, check my profile link.",
        ),
        expected_disposition="remove",
    ),
)
