"""Idempotently provision the moderator's Langfuse resources so they re-create on a FRESH stack
(``pnpm dev:down && pnpm dev`` wipes Langfuse's DB): the live-editable system prompt, the golden
dataset, and the human-annotation queue. Run on boot (``wiring``) — best-effort, never raises.

UI-configured state (online LLM-judge evaluators) cannot be seeded — there is no Langfuse API for it —
so it is the one thing that does not survive a fresh stack; the dataset-run script
(``langfuse_dataset_run``) is the reproducible, API-driven alternative for the Evaluations view.
"""

from __future__ import annotations

import contextlib
import json
import logging
from pathlib import Path

from .config import Settings
from .langfuse_integration import LangfuseClient
from .workflow.prompts import static_system_instructions

_logger = logging.getLogger(__name__)

# gold.json ships in the image (Dockerfile copies evals/golden). parents[2] is the service root both
# in-container (/app) and in the repo (services/moderator-agent).
GOLD_PATH = Path(__file__).resolve().parents[2] / "evals" / "golden" / "gold.json"

# The golden set is two-valued (allow|flag); the agent is three-valued. Map for the expected output.
VERDICT_TO_DISPOSITION = {"allow": "approve", "flag": "remove"}


async def seed_langfuse(client: LangfuseClient, settings: Settings) -> str | None:
    """Provision prompt + dataset + annotation queue. Returns the queue id (or None). Idempotent and
    best-effort: each step is isolated so one failure does not block the others or the boot."""
    if not client.enabled:
        return None
    with contextlib.suppress(Exception):
        await client.upsert_prompt(settings.langfuse_prompt_name, static_system_instructions())
    # A `{{post}}`-templated chat prompt for the Langfuse UI "Run Experiment" (prompt+model only — no
    # retrieval, so weaker than the agent; the dataset-run script is the real agent eval). Its
    # `{{post}}` maps to the moderator-golden item input `post`, so one dataset serves both.
    with contextlib.suppress(Exception):
        await client.upsert_chat_prompt(
            settings.langfuse_eval_prompt_name,
            [
                {"role": "system", "content": static_system_instructions()},
                {"role": "user", "content": "Post to moderate:\n\n{{post}}"},
            ],
        )
    with contextlib.suppress(Exception):
        await _seed_dataset(client, settings)
    # The default evaluator model: an OpenAI LLM connection (the moderator's pinned model + its key)
    # so the Evaluations / LLM-judge / playground have a model to run. Skipped without a key.
    if settings.openai_api_key:
        with contextlib.suppress(Exception):
            await client.ensure_llm_connection(
                provider="openai",
                adapter="openai",
                secret_key=settings.openai_api_key,
                custom_models=[settings.moderator_model.split(":", 1)[-1]],
            )
    queue_id: str | None = None
    with contextlib.suppress(Exception):
        queue_id = await client.ensure_annotation_queue(settings.langfuse_annotation_queue)
    return queue_id


async def _seed_dataset(client: LangfuseClient, settings: Settings) -> None:
    if not GOLD_PATH.exists():
        _logger.info("langfuse seed: %s not found, skipping dataset", GOLD_PATH)
        return
    data = json.loads(GOLD_PATH.read_text(encoding="utf-8"))
    await client.ensure_dataset(
        settings.langfuse_dataset_name,
        "SME golden set: post → expected disposition (post → approve/remove).",
    )
    for case in data.get("cases", []):
        verdict = case.get("gold_verdict")
        await client.upsert_dataset_item(
            dataset=settings.langfuse_dataset_name,
            item_id=case["id"],
            input_={"post": case["post"]},
            expected_output={
                "disposition": VERDICT_TO_DISPOSITION.get(verdict, "escalate_to_human"),
                "gold_verdict": verdict,
                "status": case.get("status"),
            },
        )
