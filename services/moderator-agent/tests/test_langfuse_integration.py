from moderator_agent.config import Settings
from moderator_agent.langfuse_integration import LangfuseClient, current_trace_id


def _off() -> Settings:
    return Settings(langfuse_host="", langfuse_public_key="", langfuse_secret_key="")


def test_client_is_disabled_without_full_config() -> None:
    assert LangfuseClient(_off()).enabled is False
    # All three required: host + both keys.
    partial = LangfuseClient(
        Settings(langfuse_host="http://x", langfuse_public_key="pk", langfuse_secret_key="")
    )
    assert partial.enabled is False


async def test_get_prompt_returns_fallback_when_disabled() -> None:
    client = LangfuseClient(_off())
    assert await client.get_prompt_text("moderator-system", fallback="HARDCODED") == "HARDCODED"


async def test_disabled_client_methods_are_noops() -> None:
    # A disabled client never touches the network and never raises — observability is best-effort.
    client = LangfuseClient(_off())
    await client.create_score(trace_id="t", name="confidence", value=0.9, data_type="NUMERIC")
    await client.upsert_prompt("p", "text")
    await client.upsert_dataset_item(dataset="d", item_id="i", input_={}, expected_output={})
    await client.add_queue_item(queue_id="q", trace_id="t")
    assert await client.ensure_annotation_queue("q") is None


def test_current_trace_id_is_none_outside_a_span() -> None:
    # No active recording span (tracing off) → nothing to attach scores to.
    assert current_trace_id() is None
