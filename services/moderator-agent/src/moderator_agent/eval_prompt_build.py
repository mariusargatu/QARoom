"""Generate the Promptfoo prompt + verdict schema from the SAME builders the service uses.

The golden-set eval must exercise the real moderation prompt, not a copy. So the system message is
``build_system_prompt`` over the general community's committed rules, and the response schema is the
Pydantic ``LlmVerdict``. A pytest drift gate asserts the committed eval artifacts match this output,
so the eval can never silently diverge from the running agent (ADR-0017).

Run: ``pnpm --filter @qaroom/moderator-agent eval:prompt``.
"""

from __future__ import annotations

import json
from pathlib import Path

from .persistence.rules_seed import load_rules_dir
from .schemas import LlmVerdict
from .workflow.prompts import build_system_prompt

_ROOT = Path(__file__).resolve().parents[2]
_EVALS = _ROOT / "evals"
_PROMPT_OUT = _EVALS / "moderation.prompt.json"
_SCHEMA_OUT = _EVALS / "llm-verdict.schema.json"
_GENERAL = "comm_" + "0" * 26

# json_object mode requires the word "json" in the messages; the service uses json_schema and does
# not need this, so it is appended only for the eval prompt.
_JSON_NOTE = "Respond ONLY with a single JSON object matching the structured verdict above."


def render_prompt() -> str:
    rules = load_rules_dir(_ROOT / "rules").get(_GENERAL, [])
    system = build_system_prompt(rules, [], prompt_bug=False) + "\n\n" + _JSON_NOTE
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": "{{post}}"},
    ]
    return json.dumps(messages, indent=2) + "\n"


def render_schema() -> str:
    return json.dumps(LlmVerdict.model_json_schema(), indent=2) + "\n"


def main() -> None:
    _EVALS.mkdir(exist_ok=True)
    _PROMPT_OUT.write_text(render_prompt())
    _SCHEMA_OUT.write_text(render_schema())
    print(f"wrote {_PROMPT_OUT} and {_SCHEMA_OUT}")


if __name__ == "__main__":
    main()
