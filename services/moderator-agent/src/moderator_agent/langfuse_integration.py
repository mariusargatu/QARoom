"""Thin Langfuse public-API client (httpx) for the observability features the moderator fills:
managed prompts, scores, datasets, and the human-annotation queue.

Deliberately NOT the ``langfuse`` Python SDK: traces already flow via OpenInference → OTLP (see
``telemetry.py``), and the SDK would stand up a SECOND OTel exporter. This client only calls the REST
API, so the two never fight. Every method is best-effort and a NO-OP when Langfuse is not configured —
the moderator runs identically with or without it, and an unreachable Langfuse never breaks a review.

Scores/annotations link to the OpenInference trace by its OTel trace id (Langfuse ingests OTLP traces
under that id), so a score shows up ON the agent's trace.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Literal

import httpx
from opentelemetry import trace as _trace

from .config import Settings

_logger = logging.getLogger(__name__)

ScoreType = Literal["NUMERIC", "CATEGORICAL", "BOOLEAN"]
_TIMEOUT_S = 3.0


def current_trace_id() -> str | None:
    """The active OpenInference span's OTel trace id as 32-char hex, or None outside a span. This is
    the id Langfuse files the trace under, so scores/annotations attach to the right trace."""
    ctx = _trace.get_current_span().get_span_context()
    if not ctx.is_valid:
        return None
    return format(ctx.trace_id, "032x")


@dataclass
class _Cached:
    text: str
    at: float


class LangfuseClient:
    """Best-effort Langfuse REST client. `enabled` is False unless host + both keys are set."""

    def __init__(self, settings: Settings) -> None:
        self._enabled = bool(
            settings.langfuse_host and settings.langfuse_public_key and settings.langfuse_secret_key
        )
        self._base = settings.langfuse_host.rstrip("/") if self._enabled else ""
        self._auth = (settings.langfuse_public_key, settings.langfuse_secret_key)
        self._prompt_ttl = settings.langfuse_prompt_cache_ttl_s
        self._prompt_cache: dict[str, _Cached] = {}

    @property
    def enabled(self) -> bool:
        return self._enabled

    async def _request(
        self, method: str, path: str, *, json: object = None
    ) -> httpx.Response | None:
        """One authenticated request. Returns None (never raises) on any failure — observability must
        never break the moderation path."""
        if not self._enabled:
            return None
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
                resp = await client.request(
                    method, f"{self._base}{path}", json=json, auth=self._auth
                )
            resp.raise_for_status()
            return resp
        except Exception as exc:
            _logger.warning("langfuse %s %s failed: %s", method, path, exc)
            return None

    # ── Prompts (live-editable, hardcoded fallback) ───────────────────────────────────────────────
    async def get_prompt_text(self, name: str, *, fallback: str) -> str:
        """The production prompt text from Langfuse, cached for ``langfuse_prompt_cache_ttl_s``. Falls
        back to ``fallback`` (the hardcoded prompt) when Langfuse is off, unreachable, or has no such
        prompt — so editing the prompt in the UI is live, but the agent is never blocked by Langfuse."""
        if not self._enabled:
            return fallback
        cached = self._prompt_cache.get(name)
        if cached is not None and (time.monotonic() - cached.at) < self._prompt_ttl:
            return cached.text
        resp = await self._request("GET", f"/api/public/v2/prompts/{name}")
        if resp is None:
            return cached.text if cached is not None else fallback
        text = resp.json().get("prompt")
        if not isinstance(text, str):
            return cached.text if cached is not None else fallback
        self._prompt_cache[name] = _Cached(text=text, at=time.monotonic())
        return text

    async def upsert_prompt(self, name: str, prompt_text: str) -> None:
        """Create/version a text prompt labelled ``production``. Idempotent enough for seeding: a new
        version is created only when the text differs from the current production version."""
        current = await self._request("GET", f"/api/public/v2/prompts/{name}")
        if current is not None and current.json().get("prompt") == prompt_text:
            return
        await self._request(
            "POST",
            "/api/public/v2/prompts",
            json={"name": name, "type": "text", "prompt": prompt_text, "labels": ["production"]},
        )

    async def upsert_chat_prompt(self, name: str, messages: list[dict[str, str]]) -> None:
        """Create/version a CHAT prompt (list of {role, content} with ``{{var}}`` placeholders),
        labelled ``production``. Used for the Langfuse UI experiment template — its ``{{post}}`` turn
        maps to the dataset item's ``input.post``. Idempotent (skips when unchanged)."""
        current = await self._request("GET", f"/api/public/v2/prompts/{name}")
        if current is not None and current.json().get("prompt") == messages:
            return
        await self._request(
            "POST",
            "/api/public/v2/prompts",
            json={"name": name, "type": "chat", "prompt": messages, "labels": ["production"]},
        )

    # ── Scores (per decision, linked to the trace) ────────────────────────────────────────────────
    async def create_score(
        self,
        *,
        trace_id: str,
        name: str,
        value: float | str,
        data_type: ScoreType,
        comment: str | None = None,
    ) -> None:
        body: dict[str, object] = {
            "traceId": trace_id,
            "name": name,
            "value": value,
            "dataType": data_type,
        }
        if comment is not None:
            body["comment"] = comment
        await self._request("POST", "/api/public/scores", json=body)

    # ── Datasets (the golden set → online experiments) ────────────────────────────────────────────
    async def ensure_dataset(self, name: str, description: str) -> None:
        # POST /v2/datasets upserts by name (idempotent).
        await self._request(
            "POST", "/api/public/v2/datasets", json={"name": name, "description": description}
        )

    async def upsert_dataset_item(
        self, *, dataset: str, item_id: str, input_: object, expected_output: object
    ) -> None:
        # A stable id makes re-seeding idempotent (upsert by id).
        await self._request(
            "POST",
            "/api/public/dataset-items",
            json={
                "datasetName": dataset,
                "id": item_id,
                "input": input_,
                "expectedOutput": expected_output,
            },
        )

    async def create_dataset_run_item(
        self, *, run_name: str, dataset_item_id: str, trace_id: str
    ) -> None:
        """Link a trace to a dataset item under a named run — this is what populates the Evaluations
        (dataset-runs) view."""
        await self._request(
            "POST",
            "/api/public/dataset-run-items",
            json={"runName": run_name, "datasetItemId": dataset_item_id, "traceId": trace_id},
        )

    # ── LLM connection (the default evaluator model the judges/playground use) ─────────────────────
    async def ensure_llm_connection(
        self,
        *,
        provider: str,
        adapter: str,
        secret_key: str,
        custom_models: list[str] | None = None,
    ) -> None:
        """Upsert (by ``provider``) the LLM connection Langfuse's evaluators + playground use — i.e.
        the DEFAULT EVALUATOR MODEL and its API key. PUT is an upsert, so it is idempotent and survives
        a fresh stack. The key is stored Langfuse-side encrypted (ENCRYPTION_KEY); it is in the request
        body, never logged."""
        body: dict[str, object] = {
            "provider": provider,
            "adapter": adapter,
            "secretKey": secret_key,
            "withDefaultModels": True,
        }
        if custom_models:
            body["customModels"] = custom_models
        await self._request("PUT", "/api/public/llm-connections", json=body)

    # ── Annotation queue (escalate_to_human → SME review) ─────────────────────────────────────────
    async def ensure_score_config(self, name: str) -> str | None:
        """Return the id of a CATEGORICAL score config named ``name`` (the dimension SME reviewers
        score on — the human's disposition), creating it if absent. A queue needs ≥1 of these."""
        existing = await self._request("GET", "/api/public/score-configs")
        if existing is not None:
            for cfg in existing.json().get("data", []):
                if cfg.get("name") == name:
                    return cfg.get("id")
        created = await self._request(
            "POST",
            "/api/public/score-configs",
            json={
                "name": name,
                "dataType": "CATEGORICAL",
                "categories": [
                    {"label": "approve", "value": 0},
                    {"label": "remove", "value": 1},
                    {"label": "escalate_to_human", "value": 2},
                ],
            },
        )
        return created.json().get("id") if created is not None else None

    async def ensure_annotation_queue(self, name: str) -> str | None:
        """Return the id of the queue named ``name``, creating it if absent. A Langfuse queue requires
        ≥1 score config, so ensure one (the reviewer-disposition dimension) first. Idempotent."""
        existing = await self._request("GET", "/api/public/annotation-queues")
        if existing is not None:
            for q in existing.json().get("data", []):
                if q.get("name") == name:
                    return q.get("id")
        config_id = await self.ensure_score_config("reviewer_disposition")
        if config_id is None:
            return None
        created = await self._request(
            "POST",
            "/api/public/annotation-queues",
            json={
                "name": name,
                "description": "Posts the moderator escalated for human review.",
                "scoreConfigIds": [config_id],
            },
        )
        return created.json().get("id") if created is not None else None

    async def add_queue_item(self, *, queue_id: str, trace_id: str) -> None:
        await self._request(
            "POST",
            f"/api/public/annotation-queues/{queue_id}/items",
            json={"objectId": trace_id, "objectType": "TRACE"},
        )
