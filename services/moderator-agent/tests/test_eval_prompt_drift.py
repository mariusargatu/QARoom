from pathlib import Path

from moderator_agent import eval_prompt_build

_EVALS = Path(__file__).resolve().parents[1] / "evals"


def test_committed_eval_prompt_matches_the_service_prompt() -> None:
    committed = (_EVALS / "moderation.prompt.json").read_text()
    assert committed == eval_prompt_build.render_prompt(), (
        "run `pnpm --filter @qaroom/moderator-agent eval:prompt`"
    )


def test_committed_verdict_schema_matches_pydantic() -> None:
    committed = (_EVALS / "llm-verdict.schema.json").read_text()
    assert committed == eval_prompt_build.render_schema()
