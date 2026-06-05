"""FastAPI app factory. Built from injected dependencies so a TestClient wires in-memory fakes."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from fastapi import FastAPI, Header
from fastapi.responses import JSONResponse

from .. import telemetry
from ..config import Settings
from ..determinism import Clock
from ..idempotency import body_hash
from ..ids import is_branded
from ..lamport import LamportGate, as_of
from ..ports import DecisionStore, IdempotencyStore, KnowledgeStore
from ..problem import NextAction, ProblemError, register_problem_handlers
from ..schemas import (
    AsOfModel,
    CapabilitiesModel,
    CapabilityModel,
    ModerationDecisionList,
    PostCreatedEvent,
    ReviewRequest,
    SystemStateModel,
    iso_z,
)
from ..workflow.graph import ModerationWorkflow
from .operations import OPERATIONS

# Human-facing route hint for the 409 next_action (a template). The idempotency CACHE key, by
# contrast, uses the CONCRETE community + post (see review_post) so the namespace is per-tenant and
# per-post — a replayed key can never return another community's (or another post's) decision.
_REVIEW_ROUTE = "POST /api/communities/{communityId}/posts/{postId}/review"


@dataclass
class AppDeps:
    workflow: ModerationWorkflow
    decisions: DecisionStore
    knowledge: KnowledgeStore
    idempotency: IdempotencyStore
    clock: Clock
    lamport: LamportGate
    settings: Settings
    ready_check: Callable[[], Awaitable[bool]] | None = None


def _as_of_model(deps: AppDeps) -> AsOfModel:
    envelope = as_of(deps.clock, deps.lamport)
    return AsOfModel(
        snapshot_id=envelope.snapshot_id, lamport=envelope.lamport, wall_clock=envelope.wall_clock
    )


def _require_branded(prefix: str, value: str, field: str) -> None:
    if not is_branded(prefix, value):
        raise ProblemError(
            slug="invalid-id",
            title=f"Invalid {field}",
            status=400,
            failure_domain="validation",
            detail=f"{field} must be {prefix}_<ulid>",
        )


def build_app(deps: AppDeps) -> FastAPI:
    app = FastAPI(
        title="moderator-agent",
        version="0.0.0",
        summary="QARoom LLM community moderator (Milestone 9). Proposes; does not enforce.",
    )
    app.state.deps = deps
    register_problem_handlers(app)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/ready")
    async def ready() -> JSONResponse:
        ok = True if deps.ready_check is None else await deps.ready_check()
        if not ok:
            # Non-2xx must be RFC 7807, even on a probe path (conventions §4).
            raise ProblemError(
                slug="not-ready",
                title="Service is not ready",
                status=503,
                failure_domain="dependency_failure",
                detail="a dependency (database) is not reachable yet",
                retryable=True,
            )
        return JSONResponse(status_code=200, content={"status": "ready"})

    @app.get("/system/state")
    async def system_state() -> SystemStateModel:
        return SystemStateModel(
            service="moderator-agent",
            models={
                "moderation_decisions": {"count": await deps.decisions.count()},
                "post_embeddings": {"count": await deps.knowledge.count_embeddings()},
                "workflow": {"state": deps.workflow.last_state},
            },
            as_of=_as_of_model(deps),
        )

    @app.get("/system/capabilities")
    async def system_capabilities() -> CapabilitiesModel:
        return CapabilitiesModel(
            service="moderator-agent",
            capabilities=[
                CapabilityModel(
                    operation_id=op.operation_id,
                    method=op.method,
                    path=op.path,
                    summary=op.summary,
                    description=op.description,
                    mutating=op.mutating,
                    input_schema=op.input_schema,
                )
                for op in OPERATIONS
            ],
            as_of=_as_of_model(deps),
        )

    @app.get("/api/communities/{communityId}/moderation-decisions")
    async def list_decisions(communityId: str) -> ModerationDecisionList:
        _require_branded("comm", communityId, "communityId")
        # Every span on a community-scoped path carries tenant.id (AGENTS.md), matching the consumer.
        with telemetry.tenant_scope(communityId):
            decisions = await deps.decisions.list_for(communityId)
            return ModerationDecisionList(decisions=decisions, as_of=_as_of_model(deps))

    @app.get("/api/communities/{communityId}/moderation-decisions/{decisionId}")
    async def get_decision(communityId: str, decisionId: str):
        _require_branded("comm", communityId, "communityId")
        _require_branded("mdec", decisionId, "decisionId")
        with telemetry.tenant_scope(communityId):
            decision = await deps.decisions.get(communityId, decisionId)
            if decision is None:
                raise ProblemError(
                    slug="decision-not-found",
                    title="Moderation decision not found",
                    status=404,
                    failure_domain="not_found",
                    detail=f"no decision {decisionId} in community {communityId}",
                )
            return decision

    @app.post(
        "/api/communities/{communityId}/posts/{postId}/review",
        status_code=200,
        openapi_extra={
            "responses": {
                "200": {
                    "links": {
                        "GetDecision": {
                            "operationId": "getModerationDecision",
                            "parameters": {
                                "communityId": "$request.path.communityId",
                                "decisionId": "$response.body#/decision_id",
                            },
                        }
                    }
                }
            }
        },
    )
    async def review_post(
        communityId: str,
        postId: str,
        body: ReviewRequest,
        idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ):
        if not deps.settings.moderator_enable_manual_review:
            # Production moderation flows through the NATS consumer; the manual trigger is dev-only
            # and is disabled in the prod Helm values (ADR-0018).
            raise ProblemError(
                slug="manual-review-disabled",
                title="Manual review is disabled",
                status=403,
                failure_domain="authorization",
                detail="the production moderation path is the NATS consumer; set MODERATOR_ENABLE_MANUAL_REVIEW for dev",
            )
        _require_branded("comm", communityId, "communityId")
        _require_branded("post", postId, "postId")
        if idempotency_key is None:
            raise ProblemError(
                slug="missing-idempotency-key",
                title="Idempotency-Key header is required",
                status=400,
                failure_domain="validation",
                detail="all mutations require an Idempotency-Key (Commitment 4)",
            )
        if body.post_id != postId:
            raise ProblemError(
                slug="post-id-mismatch",
                title="postId path does not match body",
                status=400,
                failure_domain="validation",
            )
        with telemetry.tenant_scope(communityId):
            # Idempotency cache (Commitment 4): a replay of the same key + body returns the stored
            # response WITHOUT re-running the workflow (so no second LLM call); the same key with a
            # different body is a 409 conflict. The cache route carries the CONCRETE community + post
            # (not the placeholder template) so the key namespace is per-tenant — a key reused across
            # communities can never replay another tenant's decision.
            cache_route = f"POST /api/communities/{communityId}/posts/{postId}/review"
            digest = body_hash(body.model_dump(mode="json"))
            cached = await deps.idempotency.find(
                key=idempotency_key, route=cache_route, body_hash=digest
            )
            if cached is not None:
                return JSONResponse(status_code=cached.status, content=cached.body)
            if await deps.idempotency.conflicts(
                key=idempotency_key, route=cache_route, body_hash=digest
            ):
                raise ProblemError(
                    slug="idempotency-key-conflict",
                    title="Idempotency-Key reused with a different body",
                    status=409,
                    failure_domain="conflict",
                    detail="this Idempotency-Key was already used for a request with a different body",
                    next_actions=[
                        NextAction(
                            verb="POST",
                            href=_REVIEW_ROUTE,
                            description="retry with a fresh Idempotency-Key",
                        )
                    ],
                )
            event = PostCreatedEvent(
                event_id=body.event_id,
                post_id=body.post_id,
                community_id=communityId,
                author_id=body.author_id,
                title=body.title,
                body=body.body,
                created_at=body.created_at,
            )
            decision = await deps.workflow.run(event)
            if decision is None:
                # A dependency failure is retryable — do NOT cache it (a replay must get a fresh try).
                raise ProblemError(
                    slug="moderation-unavailable",
                    title="Moderation could not be completed",
                    status=502,
                    failure_domain="dependency_failure",
                    detail="the workflow ended in Failed (a dependency was unavailable)",
                    retryable=True,
                )
            response_body = decision.model_dump(mode="json")
            await deps.idempotency.store(
                key=idempotency_key,
                route=cache_route,
                body_hash=digest,
                status=200,
                body=response_body,
                created_at=iso_z(deps.clock.now()),
            )
            return JSONResponse(status_code=200, content=response_body)

    try:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

        FastAPIInstrumentor.instrument_app(app)
    except Exception:
        pass

    return app
