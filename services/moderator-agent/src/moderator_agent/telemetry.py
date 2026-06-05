"""OpenTelemetry wiring (Commitment 12), Python sibling of ``packages/otel``.

Three things matter here, and they mirror the TypeScript SDK exactly:

* **``tenant.id`` on every span** — a ``TenantSpanProcessor`` stamps it on span start from a
  contextvar set per request / per consumed event, so HTTP, LLM, and transition spans are all
  attributable to a community.
* **GenAI semantic conventions on every LLM call** — ``gen_ai.*`` attributes (the opt-in
  ``OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental`` has been set since Milestone 3).
* **``xstate.transition`` spans** for the LangGraph workflow — identical span name and
  ``xstate.{machine,from,to,event,at}`` attributes as the XState services, so the Milestone-5
  Tracetest reverse-conformance assertion works unchanged (ADR-0012, ADR-0017).

Every helper goes through ``opentelemetry.trace.get_tracer``; with no provider installed (tests)
they are silent no-ops, so the determinism rule holds — the SDK is off unless an OTLP endpoint is set.
"""

from __future__ import annotations

import contextlib
import contextvars
from collections.abc import Iterator

from opentelemetry import trace
from opentelemetry.trace import Span, Tracer

from .config import Settings

TENANT_ID_ATTR = "tenant.id"
XSTATE_TRANSITION_SPAN = "xstate.transition"
SYSTEM_TENANT = "system"

_TENANT: contextvars.ContextVar[str] = contextvars.ContextVar(
    "qaroom_tenant_id", default=SYSTEM_TENANT
)


def current_tenant() -> str:
    return _TENANT.get()


@contextlib.contextmanager
def tenant_scope(community_id: str) -> Iterator[None]:
    token = _TENANT.set(community_id)
    try:
        yield
    finally:
        _TENANT.reset(token)


def tracer() -> Tracer:
    return trace.get_tracer("qaroom.moderator")


@contextlib.contextmanager
def genai_span(model: str, operation: str = "chat") -> Iterator[Span]:
    """A GenAI-semconv span around an LLM call. Caller records usage via ``record_genai_usage``."""
    with tracer().start_as_current_span(f"gen_ai.{operation}") as span:
        span.set_attribute("gen_ai.system", "openai")
        span.set_attribute("gen_ai.operation.name", operation)
        span.set_attribute("gen_ai.request.model", model)
        yield span


def record_genai_usage(
    span: Span, *, response_model: str, input_tokens: int | None, output_tokens: int | None
) -> None:
    span.set_attribute("gen_ai.response.model", response_model)
    if input_tokens is not None:
        span.set_attribute("gen_ai.usage.input_tokens", input_tokens)
    if output_tokens is not None:
        span.set_attribute("gen_ai.usage.output_tokens", output_tokens)


def emit_transition_span(*, machine: str, frm: str, to: str, event: str, at: str) -> None:
    """Emit one ``xstate.transition`` span — byte-compatible attrs with ``@qaroom/otel`` (ADR-0012)."""
    span = tracer().start_span(XSTATE_TRANSITION_SPAN)
    span.set_attribute("xstate.machine", machine)
    span.set_attribute("xstate.from", frm)
    span.set_attribute("xstate.to", to)
    span.set_attribute("xstate.event", event)
    span.set_attribute("xstate.at", at)
    span.end()


def setup_telemetry(settings: Settings) -> None:
    """Install the SDK iff an OTLP endpoint is configured. Otherwise the helpers stay no-ops."""
    if not settings.otel_exporter_otlp_endpoint:
        return
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import SpanProcessor, TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    class TenantSpanProcessor(SpanProcessor):
        def on_start(self, span: Span, parent_context: object | None = None) -> None:
            span.set_attribute(TENANT_ID_ATTR, _TENANT.get())

        def on_end(self, span: object) -> None:
            return None

        def shutdown(self) -> None:
            return None

        def force_flush(self, timeout_millis: int = 30_000) -> bool:
            return True

    resource = Resource.create({"service.name": settings.otel_service_name})
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(TenantSpanProcessor())
    endpoint = settings.otel_exporter_otlp_endpoint.rstrip("/") + "/v1/traces"
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint)))
    trace.set_tracer_provider(provider)
