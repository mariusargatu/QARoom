/**
 * The runtime binding between spec/tla/Outbox.tla and the transactional-outbox relay
 * (ADR-0024, Phase 3; T19).
 *
 * Outbox.tla proves the at-least-once relay protocol holds under all interleavings; this is the same
 * legal committed-transition relation, projected onto the persisted outbox row's lifecycle. The
 * committed states collapse to the `published_at` column: `Pending` (NULL) or `Sent` (stamped). A
 * relay drain commits exactly one of:
 *
 *   Pending --publish failed-->  Pending   (attempts++, stays re-claimable — never lost)
 *   Pending --publish ok-->      Sent      (published_at stamped)
 *
 * `assertLegalOutboxCommit` is called by `relay.ts#publishOne` before it stamps `published_at`, so a
 * row can never be marked Sent without a successful NATS publish — the at-least-once guard
 * (`SentImpliesPublished`). The spec-level twin of that bug is the commented `BugMarkSentOnFail`
 * action in Outbox.tla; the runtime twin is `assertLegalOutboxCommit('Pending','Sent', false)`, which
 * this module's test proves throws.
 */
export type OutboxRowState = 'Pending' | 'Sent'

const LEGAL_OUTBOX_COMMIT: Readonly<Record<OutboxRowState, ReadonlySet<OutboxRowState>>> = {
  // A failed publish leaves the row Pending (attempts++); a successful publish moves it to Sent.
  Pending: new Set<OutboxRowState>(['Pending', 'Sent']),
  // Sent is terminal — a delivered event is never un-sent.
  Sent: new Set<OutboxRowState>([]),
}

/**
 * Throw if a committed outbox transition is off-protocol vs Outbox.tla's `Next` relation:
 *  - `from` -> `to` must be a legal edge (Sent is terminal); and
 *  - a move to `Sent` requires a successful publish (`publishOk`) — the lost-event guard.
 */
export function assertLegalOutboxCommit(
  from: OutboxRowState,
  to: OutboxRowState,
  publishOk: boolean,
): void {
  if (!LEGAL_OUTBOX_COMMIT[from].has(to)) {
    throw new Error(`illegal outbox commit ${from} -> ${to} (off Outbox.tla Next relation)`)
  }
  if (to === 'Sent' && !publishOk) {
    throw new Error(
      'mark-sent without a successful publish (violates Outbox.tla SentImpliesPublished)',
    )
  }
}
