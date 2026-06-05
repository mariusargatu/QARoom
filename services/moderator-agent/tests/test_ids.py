import pytest

from moderator_agent.ids import PREFIXES, is_branded

_BODY = "0" * 26


@pytest.mark.parametrize("prefix", list(PREFIXES.values()))
def test_branded_accepts_its_own_prefix(prefix: str) -> None:
    assert is_branded(prefix, f"{prefix}_{_BODY}")


@pytest.mark.parametrize("prefix", list(PREFIXES.values()))
def test_branded_rejects_a_foreign_prefix(prefix: str) -> None:
    foreign = "comm" if prefix != "comm" else "user"
    assert not is_branded(prefix, f"{foreign}_{_BODY}")


def test_branded_rejects_a_short_body() -> None:
    assert not is_branded("evt", "evt_tooshort")


def test_branded_rejects_excluded_crockford_letters() -> None:
    # I, L, O, U are not in the ULID alphabet.
    assert not is_branded("evt", "evt_" + "I" * 26)


def test_every_prefix_is_distinct() -> None:
    values = list(PREFIXES.values())
    assert len(set(values)) == len(values)
