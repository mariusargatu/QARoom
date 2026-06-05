"""RFC 7807 Problem Details (Commitment 13), Python mirror of ``packages/contracts/src/errors.ts``.

Every non-2xx response is ``application/problem+json`` and carries the three agent-actionable
extensions: ``retryable``, ``next_actions``, ``failure_domain``. ``failure_domain`` is the same
closed enum as the TypeScript services so an agent sees one error vocabulary across the system.
"""

from __future__ import annotations

from typing import Literal

from fastapi import Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

FailureDomain = Literal[
    "validation",
    "authentication",
    "authorization",
    "tenant_resolution",
    "rate_limit",
    "conflict",
    "not_found",
    "dependency_failure",
    "internal_error",
]

HttpVerb = Literal["GET", "POST", "PUT", "PATCH", "DELETE"]

ERROR_TYPE_BASE = "https://qaroom.dev/errors"


class NextAction(BaseModel):
    verb: HttpVerb
    href: str
    description: str


class ProblemDetails(BaseModel):
    type: str
    title: str
    status: int
    detail: str | None = None
    instance: str | None = None
    retryable: bool = False
    next_actions: list[NextAction] = []
    failure_domain: FailureDomain


class ProblemError(Exception):
    """Raise to return an RFC 7807 response. The handler stamps ``instance`` from the request URL."""

    def __init__(
        self,
        *,
        slug: str,
        title: str,
        status: int,
        failure_domain: FailureDomain,
        detail: str | None = None,
        retryable: bool = False,
        next_actions: list[NextAction] | None = None,
    ) -> None:
        super().__init__(title)
        self.problem = ProblemDetails(
            type=f"{ERROR_TYPE_BASE}/{slug}",
            title=title,
            status=status,
            detail=detail,
            retryable=retryable,
            next_actions=next_actions or [],
            failure_domain=failure_domain,
        )


def _response(problem: ProblemDetails) -> JSONResponse:
    return JSONResponse(
        status_code=problem.status,
        content=problem.model_dump(mode="json"),
        media_type="application/problem+json",
    )


def register_problem_handlers(app) -> None:
    """Map ProblemError, request-validation, and the catch-all to RFC 7807 responses."""
    from fastapi.exceptions import RequestValidationError
    from starlette.exceptions import HTTPException as StarletteHTTPException

    @app.exception_handler(ProblemError)
    async def _on_problem(request: Request, exc: ProblemError) -> JSONResponse:
        exc.problem.instance = str(request.url)
        return _response(exc.problem)

    @app.exception_handler(RequestValidationError)
    async def _on_validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        problem = ProblemDetails(
            type=f"{ERROR_TYPE_BASE}/validation-failed",
            title="Request validation failed",
            status=422,
            detail=str(exc.errors()[:3]),
            instance=str(request.url),
            failure_domain="validation",
        )
        return _response(problem)

    @app.exception_handler(StarletteHTTPException)
    async def _on_http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        domain: FailureDomain = "not_found" if exc.status_code == 404 else "internal_error"
        problem = ProblemDetails(
            type=f"{ERROR_TYPE_BASE}/http-{exc.status_code}",
            title=str(exc.detail),
            status=exc.status_code,
            instance=str(request.url),
            failure_domain=domain,
        )
        return _response(problem)

    @app.exception_handler(Exception)
    async def _on_unexpected(request: Request, exc: Exception) -> JSONResponse:
        # Never leak the message of an unexpected error (mirrors the TS internal-error handler).
        problem = ProblemDetails(
            type=f"{ERROR_TYPE_BASE}/internal-error",
            title="Internal Server Error",
            status=500,
            instance=str(request.url),
            failure_domain="internal_error",
        )
        return _response(problem)
