"""The tokenizer seam (ADR-0021), in isolation.

The deterministic ``WordTokenizer`` carries the always-on contract — known counts, the
truncate-is-a-prefix property, the token-bound invariant, idempotence — with no network. The real
``TiktokenTokenizer`` gets a smoke test, skipped (module-level, like the pg ``_DB`` gate) when the
``cl100k_base`` encoding can't be loaded offline.
"""

from __future__ import annotations

import pytest

from moderator_agent.tokenize import TiktokenTokenizer, WordTokenizer


def _tiktoken_ready() -> bool:
    try:
        import tiktoken

        tiktoken.get_encoding("cl100k_base")
        return True
    except Exception:
        return False


_TIKTOKEN = _tiktoken_ready()


# --- WordTokenizer: the deterministic, always-on contract ---


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("", 0),
        ("one", 1),
        ("one two three", 3),
        ("  leading and  collapsed   spaces ", 4),
        ("line\nbreaks\tand\ttabs", 4),
    ],
)
def test_word_count_matches_known_token_counts(text: str, expected: int) -> None:
    assert WordTokenizer().count(text) == expected


@pytest.mark.parametrize("max_tokens", [1, 2, 3, 5, 8])
def test_word_truncate_bounds_the_token_count(max_tokens: int) -> None:
    text = "the quick brown fox jumps over the lazy dog"  # nine words
    out = WordTokenizer().truncate(text, max_tokens=max_tokens)
    assert WordTokenizer().count(out) == min(max_tokens, 9)


@pytest.mark.parametrize("max_tokens", [1, 2, 4, 8])
def test_word_truncate_returns_a_prefix_of_the_input(max_tokens: int) -> None:
    text = "alpha beta gamma delta epsilon"
    out = WordTokenizer().truncate(text, max_tokens=max_tokens)
    assert text.startswith(out)


def test_word_truncate_at_the_exact_count_is_the_whole_text() -> None:
    text = "alpha beta gamma"
    assert WordTokenizer().truncate(text, max_tokens=3) == text


def test_word_truncate_above_the_count_is_the_whole_text() -> None:
    text = "alpha beta gamma"
    assert WordTokenizer().truncate(text, max_tokens=99) == text


@pytest.mark.parametrize("max_tokens", [0, -1, -5])
def test_word_truncate_to_nonpositive_is_empty(max_tokens: int) -> None:
    assert WordTokenizer().truncate("alpha beta", max_tokens=max_tokens) == ""


@pytest.mark.parametrize("max_tokens", [1, 3, 5])
def test_word_truncate_is_idempotent(max_tokens: int) -> None:
    tok = WordTokenizer()
    text = "alpha beta gamma delta epsilon zeta"
    once = tok.truncate(text, max_tokens=max_tokens)
    assert tok.truncate(once, max_tokens=max_tokens) == once


# --- TiktokenTokenizer: a real-encoding smoke test (gated, like the pg integration tests) ---


@pytest.mark.skipif(not _TIKTOKEN, reason="cl100k_base encoding unavailable offline")
def test_tiktoken_truncate_bounds_the_real_token_count() -> None:
    tok = TiktokenTokenizer()
    # ASCII so the truncated id-prefix re-encodes cleanly; encodes to well over five tokens.
    text = (
        "Pseudoscience and antidisestablishmentarianism: punctuation, sub-words! Counting tokens."
    )
    assert tok.count(text) > 5
    bounded = tok.truncate(text, max_tokens=5)
    assert tok.count(bounded) == 5


@pytest.mark.skipif(not _TIKTOKEN, reason="cl100k_base encoding unavailable offline")
def test_tiktoken_reports_the_embedding_models_encoding() -> None:
    # text-embedding-3-small encodes with cl100k_base — the reason this is the embedder's tokenizer.
    assert TiktokenTokenizer().name == "cl100k_base"
