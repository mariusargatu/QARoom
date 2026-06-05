"""Production entrypoint — ``python -m moderator_agent.server``.

Builds the runtime (Postgres + pgvector + NATS + OpenAI), starts the NATS consumer, and serves the
FastAPI app with uvicorn until SIGINT/SIGTERM.
"""

from __future__ import annotations

import asyncio

import uvicorn

from .config import load_settings
from .wiring import build_runtime


async def _amain() -> None:
    settings = load_settings()
    runtime = await build_runtime(settings)
    config = uvicorn.Config(runtime.app, host="0.0.0.0", port=settings.port, log_level="info")
    server = uvicorn.Server(config)
    try:
        await server.serve()
    finally:
        await runtime.shutdown()


def main() -> None:
    asyncio.run(_amain())


if __name__ == "__main__":
    main()
