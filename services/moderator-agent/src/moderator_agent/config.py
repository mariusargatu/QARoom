"""Service configuration from the environment (pydantic-settings).

Field names map to env vars case-insensitively: ``PORT``, ``DATABASE_URL``, ``NATS_URL``,
``OPENAI_API_KEY``, ``MODERATOR_MODEL``, ``MODERATOR_PROMPT_BUG`` … The OTel + GenAI-semconv
opt-in is set in the Dockerfile/Helm values, exactly like the TS services (ADR-0009).
"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Reads real environment variables AND a local `.env` (gitignored) — env vars win. The `.env` is a
    # dev convenience for the real-LLM path (evals + the `llm`-marked test); see `.env.example`.
    model_config = SettingsConfigDict(
        env_prefix="",
        extra="ignore",
        case_sensitive=False,
        env_file=".env",
        env_file_encoding="utf-8",
    )

    port: int = 8086
    database_url: str = ""
    nats_url: str = ""

    # LLM provider via LangChain's provider-agnostic init_chat_model / init_embeddings — the id is
    # `<provider>:<model>` (ADR-0017/0018). gpt-5.5 is a REASONING model: no seed/temperature;
    # determinism is bounded by `reasoning_effort`. Pinned to the exact dated snapshot (confirmed live
    # 2026-06-05); the bare `gpt-5.5` alias would float to the newest snapshot.
    openai_api_key: str = ""
    moderator_model: str = "openai:gpt-5.5-2026-04-23"
    moderator_embedding_model: str = "openai:text-embedding-3-small"
    moderator_reasoning_effort: str = "low"
    moderator_max_post_chars: int = 8000
    # text-embedding-3-small's dimension. The embedder validates the provider returns exactly this many
    # components before the vector reaches pgvector — a guard against an unbounded/oversized response
    # (must match the `vector(N)` column in persistence/migrate.py).
    moderator_embedding_dim: int = 1536

    # Retrieve-then-reason (FR2, ADR-0020): how many policy-corpus entries the draft node reasons over.
    moderator_retrieval_limit: int = 5
    # Abstain/escalate threshold (FR5): a draft below this confidence escalates to a human instead of
    # auto-acting. The self-check node also escalates a `remove` that, after grounding, cites no rule.
    moderator_abstain_confidence: float = 0.5

    # Deliberate-bug toggles (mirror the TS CONTENT_BUG_* / M11 convention; surfaced via
    # /system/capabilities). Each defeats one M12 guarantee so a test can prove the guarantee has teeth:
    #   prompt_bug          — model keys on literal wording (metamorphic catches; golden misses).
    #   disable_input_guard — untrusted post body is NOT delimited → prompt-injection lands (DeepTeam).
    #   ungrounded          — self-check skips citation grounding → hallucinated policy survives
    #                         (DeepEval faithfulness catches it; a non-grounded eval would not).
    #   disable_abstain     — self-check never escalates → a low-confidence/conflicting case is guessed
    #                         (the calibration/abstain check catches it).
    moderator_prompt_bug: bool = False
    moderator_disable_input_guard: bool = False
    moderator_ungrounded: bool = False
    moderator_disable_abstain: bool = False

    # NATS consumer.
    nats_stream: str = "qaroom"
    moderator_subscription: str = "moderator-on-post-created"

    # The POST /review endpoint is a dev/demo trigger; production moderation flows through NATS.
    # Default on (dev/tests); the prod Helm values set this false so the endpoint refuses (ADR-0018).
    moderator_enable_manual_review: bool = True

    # Cost guard (DeepEval/DeepTeam pre-flight; CI fails if the estimate exceeds this).
    moderator_eval_budget_tokens: int = 200_000

    # Observability.
    otel_exporter_otlp_endpoint: str = ""
    otel_service_name: str = "moderator-agent"

    # Langfuse LLM-trace UI (spike). When all three are set, OpenInference LangChain/LangGraph spans
    # are exported to Langfuse over OTLP (Basic auth). Host is the in-cluster self-hosted instance
    # (deploy/observability/langfuse.yaml) or any Langfuse URL. Off by default — absent these,
    # telemetry behaves exactly as before.
    langfuse_host: str = ""
    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""
    # Names of the Langfuse resources the moderator seeds + uses (idempotent, so they re-create on a
    # fresh stack). The managed prompt is fetched at runtime with a hardcoded fallback; cache TTL
    # bounds how fast a live edit in the Langfuse UI propagates to the agent.
    langfuse_prompt_name: str = "moderator-system"
    langfuse_prompt_cache_ttl_s: float = 60.0
    # A SEPARATE chat prompt (system instructions + a `{{post}}` user turn) used ONLY by Langfuse's UI
    # "Run Experiment" (prompt+model, no retrieval). Kept apart from the agent's `moderator-system` so
    # adding the template variable can't corrupt the agent's runtime prompt.
    langfuse_eval_prompt_name: str = "moderator-prompt-eval"
    langfuse_dataset_name: str = "moderator-golden"
    langfuse_annotation_queue: str = "moderator-escalations"

    # Scenario replay (Milestone 7 parity): SNAPSHOT_REPLAY=1 pins the clock.
    snapshot_replay: str = ""
    snapshot_clock_seed: str = "2026-01-01T00:00:00.000Z"

    @property
    def replaying(self) -> bool:
        return self.snapshot_replay == "1"


def load_settings() -> Settings:
    return Settings()
