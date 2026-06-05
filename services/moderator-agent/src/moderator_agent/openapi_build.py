"""Generate the committed ``openapi.yaml`` from the FastAPI app (run: ``pnpm --filter
@qaroom/moderator-agent openapi:generate``). A pytest drift gate asserts the committed file matches
what the live app produces, mirroring the TS ``openapi:verify`` discipline."""

from __future__ import annotations

from pathlib import Path

import yaml

from .wiring import build_schema_app

OUT = Path(__file__).resolve().parents[2] / "openapi.yaml"


def render() -> str:
    spec = build_schema_app().openapi()
    return yaml.safe_dump(spec, sort_keys=False)


def main() -> None:
    OUT.write_text(render())
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
