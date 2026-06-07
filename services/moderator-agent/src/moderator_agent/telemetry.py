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
from typing import TYPE_CHECKING

from opentelemetry import trace
from opentelemetry.trace import Span, Tracer

from .config import Settings

if TYPE_CHECKING:
    # Type-only: keeps the SDK import out of the runtime path so the helpers stay no-ops when no
    # exporter is configured (determinism rule), while pyright still sees the exporter type.
    from collections.abc import Sequence

    from opentelemetry.sdk.trace import ReadableSpan
    from opentelemetry.sdk.trace.export import SpanExporter, SpanExportResult

TENANT_ID_ATTR = "tenant.id"
XSTATE_TRANSITION_SPAN = "xstate.transition"
SYSTEM_TENANT = "system"

# Span names that are noise in the Langfuse LLM view and dropped from the LANGFUSE export ONLY (the
# collector still gets them, so Jaeger/Tracetest are unaffected): the hand-rolled gen_ai.*/
# xstate.transition spans (duplicates of OpenInference's ChatOpenAI/retriever spans + Tracetest's
# conformance signal), the HTTP send/receive sub-spans, and LangChain plumbing wrappers.
_LANGFUSE_DROP_EXACT = frozenset(
    {
        "xstate.transition",
        "gen_ai.chat",
        "gen_ai.embeddings",
        "_route",
        "RunnableSequence",
        "RunnableParallel<raw>",
        "RunnableParallel",
        "RunnableLambda",
    }
)
_LANGFUSE_DROP_SUBSTR = (" http send", " http receive")


def _drop_from_langfuse(name: str) -> bool:
    return name in _LANGFUSE_DROP_EXACT or any(s in name for s in _LANGFUSE_DROP_SUBSTR)

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
    """Install the SDK iff a trace sink is configured — the OTLP collector (Jaeger/Tracetest) and/or
    Langfuse (the LLM-trace UI). Otherwise the helpers stay no-ops, so the determinism rule holds and
    tests run with the SDK off. When Langfuse is configured, LangChain/LangGraph is auto-instrumented
    (OpenInference) so each LLM call, pgvector retrieval, and LangGraph node renders as a rich span;
    the hand-rolled ``gen_ai.*`` / ``xstate.transition`` spans keep flowing to the collector unchanged.
    """
    langfuse_exporter = _langfuse_exporter(settings)
    if not settings.otel_exporter_otlp_endpoint and langfuse_exporter is None:
        return
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
    if settings.otel_exporter_otlp_endpoint:
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

        endpoint = settings.otel_exporter_otlp_endpoint.rstrip("/") + "/v1/traces"
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint)))
    if langfuse_exporter is not None:
        from opentelemetry.sdk.trace.export import SpanExporter, SpanExportResult

        class _LangfuseFilterExporter(SpanExporter):
            """Wrap the Langfuse exporter to drop the noise/duplicate spans (see ``_drop_from_langfuse``)
            so the LLM trace view is clean. Only the Langfuse export is filtered — the collector
            processor is separate, so Jaeger/Tracetest still receive every span."""

            def __init__(self, inner: SpanExporter) -> None:
                self._inner = inner

            def export(self, spans: Sequence[ReadableSpan]) -> SpanExportResult:
                kept = [s for s in spans if not _drop_from_langfuse(s.name)]
                if not kept:
                    return SpanExportResult.SUCCESS
                return self._inner.export(kept)

            def shutdown(self) -> None:
                self._inner.shutdown()

            def force_flush(self, timeout_millis: int = 30_000) -> bool:
                return self._inner.force_flush(timeout_millis)

        provider.add_span_processor(BatchSpanProcessor(_LangfuseFilterExporter(langfuse_exporter)))
    trace.set_tracer_provider(provider)
    if langfuse_exporter is not None:
        _instrument_langchain(provider)


def langfuse_otlp_target(settings: Settings) -> tuple[str, dict[str, str]] | None:
    """The ``(endpoint, headers)`` for the Langfuse OTLP/HTTP span exporter, or ``None`` when Langfuse
    is not configured. Langfuse ingests OpenInference / OTel-GenAI spans at
    ``<host>/api/public/otel/v1/traces`` with HTTP Basic auth — base64 of
    ``<public_key>:<secret_key>`` (Langfuse cloud or a self-hosted instance). Pure, so it is unit
    tested without standing up the SDK."""
    if not (
        settings.langfuse_host and settings.langfuse_public_key and settings.langfuse_secret_key
    ):
        return None
    import base64

    token = base64.b64encode(
        f"{settings.langfuse_public_key}:{settings.langfuse_secret_key}".encode()
    ).decode()
    endpoint = settings.langfuse_host.rstrip("/") + "/api/public/otel/v1/traces"
    return endpoint, {"Authorization": f"Basic {token}"}


def _langfuse_exporter(settings: Settings) -> SpanExporter | None:
    """An OTLP/HTTP span exporter to Langfuse, or ``None`` when Langfuse is not configured."""
    target = langfuse_otlp_target(settings)
    if target is None:
        return None
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

    endpoint, headers = target
    return OTLPSpanExporter(endpoint=endpoint, headers=headers)


def _instrument_langchain(provider: object) -> None:
    """Auto-instrument LangChain/LangGraph with OpenInference so the LangGraph trajectory, retrieval,
    and each LLM generation (prompt + completion) render as rich spans in Langfuse. The package is a
    runtime dependency; the ``try`` only degrades gracefully (to the hand-rolled ``gen_ai.*`` spans)
    if it is ever stripped from the image."""
    try:
        from openinference.instrumentation.langchain import LangChainInstrumentor
    except ImportError:
        return
    LangChainInstrumentor().instrument(tracer_provider=provider)
