# Disaster-recovery posture (NAMED v1 gap)

> **Status: a conscious v1 gap, not a built feature.** QARoom's data-lifecycle work (T14, [ADR-0036](adr/0036-data-lifecycle-erasure-saga-and-online-expand-contract-migration.md))
> builds and tests **deliberate** data lifecycle — the GDPR erasure saga and online schema evolution —
> and **names** disaster recovery (recovery from *accidental* loss) rather than implementing it. This
> page records the intended posture so the gap is explicit and reviewable, in the spirit of
> [ARCHITECTURE.md §7 "What this architecture deliberately omits"](../ARCHITECTURE.md). Erasure and DR
> are distinct concerns: erasure is an audited deletion we *want*; DR is undoing a deletion we *didn't*.

## Why named, not built

Per-service Postgres is the system of record for domain state (`AGENTS.md`, "Where state lives"); NATS
JetStream's durable streams replay cross-service events. A credible DR implementation needs a backup
target (object storage), a scheduler, restore tooling, and a recurring **drill** that proves a backup is
actually restorable — none of which a single-cluster demonstration platform exercises honestly. Building
backup machinery that is never restored under load would be exactly the untested-theater this repo
exists to avoid. So v1 documents the posture and leaves the build to a deployment that has a real
recovery objective.

## Intended posture

| Concern | Posture (v1, named) |
|---|---|
| **Backup mechanism** | Per-service logical backup via `pg_dump --format=custom` per database (one dump per service DB), plus the JetStream stream snapshots for event replay. Physical/PITR (`pg_basebackup` + WAL archiving) is the production upgrade path. |
| **Schedule** | Daily full `pg_dump` per service DB; continuous WAL archiving in the PITR upgrade. |
| **Retention** | 7 daily, 4 weekly, 3 monthly (a standard tiered window); tune to the recovery objective. |
| **Restore strategy** | `pg_restore` into a fresh database, then the service's own idempotent `ensureSchema`/migration runner reconciles schema; cross-service events replay from the durable JetStream streams. |
| **Restore drill cadence** | Quarterly restore-and-verify drill into a scratch namespace, asserting row counts and a smoke read per service — a backup is only real once a restore has been proven. |
| **RPO / RTO** | RPO ≈ 24h with daily dumps (≈ minutes with WAL archiving); RTO bounded by the restore-drill measurement. Both are deployment decisions, recorded here as the dials to set. |

## Relationship to erasure

A GDPR erasure ([ADR-0036](adr/0036-data-lifecycle-erasure-saga-and-online-expand-contract-migration.md))
**must propagate to backups** to be complete: a restored backup could otherwise resurrect an erased
user. The v1 reconciliation: erasure events are durable on the JetStream stream, so a restore replays
them and re-applies the erasure; the production-grade answer is a retention window short enough that an
erased user ages out, plus a documented backup-scrub procedure. This coupling is the reason the two
concerns are recorded together.
