"""Seed ``community_rules`` and the ``policy_corpus`` from the versioned ``rules/<community_id>.yaml``.

Each file is named for its community id. As of Milestone 12 (ADR-0020) it is a mapping with ``rules``
(``{rule_id, text, severity}``) and ``escalation_guidelines`` (``{guideline_id, text}``); a bare list
is still accepted as rules-only (back-compat). Rules go to ``community_rules`` (the authored rule list,
``rules_for``); rules + guidelines are embedded into ``policy_corpus`` (the load-bearing retrieval
index — retrieve-then-reason, FR1/FR2). Seeding is idempotent (upsert), run on boot.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import yaml
from psycopg_pool import AsyncConnectionPool

from ..llm import Embedder
from ..schemas import CommunityRule, PolicyEntry
from .vectors import vector_literal

# The corpus version a boot-time seed writes. Versioned so a future re-seed can supersede it without a
# destructive drop; the PRIMARY KEY (community_id, version, entry_id) upserts within a version.
SEED_VERSION = "1"


def _parse_file(path: Path) -> tuple[list[CommunityRule], list[PolicyEntry]]:
    raw = yaml.safe_load(path.read_text()) or {}
    rules_raw = raw if isinstance(raw, list) else raw.get("rules", [])
    guidelines_raw = [] if isinstance(raw, list) else raw.get("escalation_guidelines", [])
    rules = [CommunityRule.model_validate(item) for item in rules_raw]
    entries: list[PolicyEntry] = [
        PolicyEntry(entry_id=r.rule_id, entry_type="rule", text=r.text, severity=r.severity)
        for r in rules
    ]
    entries.extend(
        PolicyEntry(
            entry_id=g["guideline_id"], entry_type="guideline", text=g["text"], severity=None
        )
        for g in guidelines_raw
    )
    return rules, entries


def load_rules_dir(rules_dir: Path) -> dict[str, list[CommunityRule]]:
    return {path.stem: _parse_file(path)[0] for path in sorted(rules_dir.glob("*.yaml"))}


def load_corpus_dir(rules_dir: Path) -> dict[str, list[PolicyEntry]]:
    return {path.stem: _parse_file(path)[1] for path in sorted(rules_dir.glob("*.yaml"))}


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


async def seed_corpus(pool: AsyncConnectionPool, rules_dir: Path, embedder: Embedder) -> int:
    """Embed and upsert each rule/guideline into ``policy_corpus``. Embedding runs in a thread (the
    provider call is sync); the deterministic ``ZeroEmbedder`` yields zeros, which the retrieve path
    short-circuits on, so a seed without a live embedder is still well-formed."""
    by_community = load_corpus_dir(rules_dir)
    written = 0
    async with pool.connection() as conn:
        for community_id, entries in by_community.items():
            for entry in entries:
                embedding = await asyncio.to_thread(embedder.embed, entry.text)
                await conn.execute(
                    "INSERT INTO policy_corpus "
                    "(community_id, version, entry_id, entry_type, text, severity, embedding, created_at) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s::vector,now()::text) "
                    "ON CONFLICT (community_id, version, entry_id) DO UPDATE SET "
                    "entry_type = EXCLUDED.entry_type, text = EXCLUDED.text, "
                    "severity = EXCLUDED.severity, embedding = EXCLUDED.embedding",
                    (
                        community_id,
                        SEED_VERSION,
                        entry.entry_id,
                        entry.entry_type,
                        entry.text,
                        entry.severity,
                        # An all-zero embedding (the deterministic ZeroEmbedder) carries no signal —
                        # store NULL so the ranked retrieve path excludes it rather than NaN-sorting it.
                        vector_literal(embedding) if embedding and any(embedding) else None,
                    ),
                )
                written += 1
        await conn.commit()
    return written
