from pathlib import Path

from moderator_agent import asyncapi_build, openapi_build

_ROOT = Path(__file__).resolve().parents[1]


def test_committed_openapi_matches_the_app() -> None:
    committed = (_ROOT / "openapi.yaml").read_text()
    assert committed == openapi_build.render(), (
        "run `pnpm --filter @qaroom/moderator-agent openapi:generate`"
    )


def test_committed_asyncapi_matches_the_generator() -> None:
    committed = (_ROOT / "asyncapi.yaml").read_text()
    assert committed == asyncapi_build.render(), (
        "run `pnpm --filter @qaroom/moderator-agent asyncapi:generate`"
    )
