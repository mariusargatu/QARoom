"""Record a cassette of the REAL model's verdict for every metamorphic paraphrase case.

This is the M14 follow-up named in ``llm_cassette.py``: committing a cassette of REAL completions so the
merge lane can replay paraphrase-invariance KEYLESSLY, instead of leaving it to the key-gated live test
(and the keyword-stem stand-in that only exercises the checker). Run it on the KEYED lane after any
prompt / corpus / model change; the committed cassette is then replayed on every PR by
``tests/test_metamorphic.py::test_the_recorded_real_model_is_paraphrase_invariant``.

    uv run python scripts/record_metamorphic_cassette.py        # honest prompt  -> metamorphic.json
    MODERATOR_PROMPT_BUG=1 uv run python scripts/record_metamorphic_cassette.py  # bug -> metamorphic-prompt-bug.json

Needs OPENAI_API_KEY (loaded from .env by Settings, or exported into the environment).
"""

from __future__ import annotations

from pathlib import Path

from moderator_agent.config import Settings
from moderator_agent.llm import LangChainLlmClient
from moderator_agent.llm_cassette import RecordingLlmClient
from moderator_agent.metamorphic import GOLDEN_CASES
from moderator_agent.persistence.rules_seed import load_corpus_dir
from moderator_agent.workflow.prompts import build_system_prompt

ROOT = Path(__file__).resolve().parents[1]
COMMUNITY = "comm_" + "0" * 26


def build_prompt(settings: Settings) -> str:
    """The exact system prompt the metamorphic test conditions on — must match the replay side byte for
    byte (the cassette is keyed on it), so both build it the same way."""
    entries = load_corpus_dir(ROOT / "rules").get(COMMUNITY, [])
    return build_system_prompt(entries, [], prompt_bug=settings.moderator_prompt_bug)


def main() -> None:
    settings = Settings()
    prompt = build_prompt(settings)
    recorder = RecordingLlmClient(LangChainLlmClient(settings))
    for case in GOLDEN_CASES:
        for text in (case.canonical, *case.paraphrases):
            verdict = recorder.classify(system_prompt=prompt, post_text=text)
            print(f"  {case.name:40s} {verdict.disposition:18s} {text[:48]!r}")
    name = "metamorphic-prompt-bug.json" if settings.moderator_prompt_bug else "metamorphic.json"
    out = ROOT / "tests" / "cassettes" / name
    out.parent.mkdir(parents=True, exist_ok=True)
    recorder.save(out)
    print(f"\nrecorded {len(recorder.cassette()['entries'])} entries -> {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
