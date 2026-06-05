"""Seed ``community_rules`` from the versioned ``rules/<community_id>.yaml`` files.

Each file is named for its community id and holds a list of ``{rule_id, text, severity}``. Seeding is
idempotent (upsert), run on boot — so the rules the LLM judges against are version-controlled, not
hidden in a prompt string (ADR-0018, the rules-store decision).
"""

from __future__ import annotations

from pathlib import Path

import yaml
from psycopg_pool import AsyncConnectionPool

from ..schemas import CommunityRule


def load_rules_dir(rules_dir: Path) -> dict[str, list[CommunityRule]]:
    by_community: dict[str, list[CommunityRule]] = {}
    for path in sorted(rules_dir.glob("*.yaml")):
        community_id = path.stem
        raw = yaml.safe_load(path.read_text()) or []
        by_community[community_id] = [CommunityRule.model_validate(item) for item in raw]
    return by_community


async def seed_rules(pool: AsyncConnectionPool, rules_dir: Path) -> int:
    by_community = load_rules_dir(rules_dir)
    written = 0
    async with pool.connection() as conn:
        for community_id, rules in by_community.items():
            for rule in rules:
                await conn.execute(
                    "INSERT INTO community_rules (community_id, rule_id, text, severity) "
                    "VALUES (%s,%s,%s,%s) "
                    "ON CONFLICT (community_id, rule_id) DO UPDATE SET "
                    "text = EXCLUDED.text, severity = EXCLUDED.severity",
                    (community_id, rule.rule_id, rule.text, rule.severity),
                )
                written += 1
        await conn.commit()
    return written
