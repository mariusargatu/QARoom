import base64

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from moderator_agent import telemetry
from moderator_agent.config import Settings
from moderator_agent.telemetry import langfuse_otlp_target


def test_langfuse_target_is_none_when_unconfigured() -> None:
    settings = Settings(langfuse_host="", langfuse_public_key="", langfuse_secret_key="")
    assert langfuse_otlp_target(settings) is None


def test_langfuse_target_requires_all_three_keys() -> None:
    # A partially-configured Langfuse must not half-activate the exporter.
    settings = Settings(
        langfuse_host="https://cloud.langfuse.com",
        langfuse_public_key="pk-lf-public",
        langfuse_secret_key="",
    )
    assert langfuse_otlp_target(settings) is None


def test_langfuse_target_builds_otlp_endpoint_and_basic_auth() -> None:
    settings = Settings(
        langfuse_host="https://cloud.langfuse.com/",
        langfuse_public_key="pk-lf-public",
        langfuse_secret_key="sk-lf-secret",
    )
    target = langfuse_otlp_target(settings)
    assert target is not None
    endpoint, headers = target
    # Trailing slash on the host is normalized; the path is Langfuse's OTLP traces endpoint.
    assert endpoint == "https://cloud.langfuse.com/api/public/otel/v1/traces"
    scheme, token = headers["Authorization"].split(" ")
    assert scheme == "Basic"
    assert base64.b64decode(token).decode() == "pk-lf-public:sk-lf-secret"


def test_transition_span_carries_agent_and_session_identity(monkeypatch) -> None:
    # T21: every emitted transition span carries agent.id + session.id so the trajectory is
    # attributable to one agent run. A local provider + in-memory exporter (monkeypatched onto the
    # module's `tracer`) reads back the real span attributes without touching the global SDK.
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    monkeypatch.setattr(telemetry, "tracer", lambda: provider.get_tracer("dst-telemetry-test"))

    telemetry.emit_transition_span(
        machine="moderator",
        frm="Drafted",
        to="SelfChecked",
        event="DraftProduced",
        at="2026-01-01T00:00:00.000Z",
        agent_id="moderator",
        session_id="evt_00000000000000000000000007",
    )

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    attributes = spans[0].attributes
    assert attributes is not None
    assert attributes["xstate.from"] == "Drafted"
    assert attributes["agent.id"] == "moderator"
    assert attributes["session.id"] == "evt_00000000000000000000000007"


def test_transition_span_omits_identity_when_not_supplied(monkeypatch) -> None:
    # Additive + backward compatible: with no agent/session the attrs are simply absent, so the
    # existing Tracetest reverse-conformance over xstate.* is unchanged.
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    monkeypatch.setattr(telemetry, "tracer", lambda: provider.get_tracer("dst-telemetry-test"))

    telemetry.emit_transition_span(
        machine="moderator", frm="Received", to="Retrieved", event="ReviewRequested", at="t"
    )

    attributes = exporter.get_finished_spans()[0].attributes
    assert attributes is not None
    assert "agent.id" not in attributes
    assert "session.id" not in attributes
