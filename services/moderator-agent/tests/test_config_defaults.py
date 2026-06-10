"""Deployment-default guard for the deliberate-bug toggles (detection-matrix fix, 2026-06-10).

The matrix's Tier C found every moderator toggle MISSED under external env injection: the eval
tests construct ``Settings(...)`` with explicit kwargs (env-blind by design — they test both
branches), so nothing anywhere failed when a bug toggle was armed in the ENVIRONMENT, which is
exactly how a deployment ships broken. This file is the in-process, keyless detector: bare
``Settings()`` reads the real environment, and every deliberate-bug toggle must be OFF by
default. Arming any of them turns exactly one assertion red.
"""

from moderator_agent.config import Settings


def test_input_guard_enabled_by_default() -> None:
    assert Settings().moderator_disable_input_guard is False


def test_prompt_bug_off_by_default() -> None:
    assert Settings().moderator_prompt_bug is False


def test_grounding_check_enabled_by_default() -> None:
    assert Settings().moderator_ungrounded is False


def test_abstain_enabled_by_default() -> None:
    assert Settings().moderator_disable_abstain is False


def test_rerank_bug_off_by_default() -> None:
    assert Settings().moderator_rerank_bug is False
