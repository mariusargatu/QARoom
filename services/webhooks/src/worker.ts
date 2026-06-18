import { createHmac } from 'node:crypto'
import {
  applyWebhookDeliveryEvent,
  nextBackoff,
  WEBHOOK_DELIVERY_ID_HEADER,
  WEBHOOK_EVENT_ID_HEADER,
  WEBHOOK_RETRY_POLICY,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  type WebhookDeliveryStateName,
  type WebhookDeliveryTransitionSink,
} from '@qaroom/contracts'
// node:crypto-backed signing lives in the dedicated subpath, not the browser-reachable barrel.
import { signWebhook } from '@qaroom/contracts/webhook-hmac'
import { dateFromEpochMillis, type Randomness } from '@qaroom/determinism'
import { createDrainLoop, rowsOf, type SqlExecutor } from '@qaroom/messaging'
import { traced, withTenant } from '@qaroom/otel'
import { sql } from 'drizzle-orm'
import type { WorkerDeps } from './deps'
import { isDelivered } from './sender'

const DEFAULT_BATCH = 50
// Auto-quarantine: a subscription that dead-letters this many deliveries in a row is Disabled
// (it stops receiving new fan-out, per the contract's `Disabled` state). A successful delivery
// resets the streak.
const DISABLE_AFTER_CONSECUTIVE_DEAD_LETTERS = 10

/**
 * A deliberate-bug chaos toggle, gated so it can NEVER fire in production. The demos run under
 * tests/dev/chaos (NODE_ENV !== 'production'); a production binary ignores the env var entirely, so
 * an operator cannot weaken signing or drop deliveries by setting one.
 */
function chaosEnabled(flag: string): boolean {
  return process.env.NODE_ENV !== 'production' && process.env[flag] === '1'
}

interface DueRow {
  id: string
  subscription_id: string
  community_id: string
  event_id: string
  event_type: string
  payload: Record<string, unknown>
  status: WebhookDeliveryStateName
  attempt: number
  url: string
  secret: string
}

export interface DeliveryWorker {
  /** Drain one batch of due deliveries; returns how many were attempted this pass. */
  drainOnce(): Promise<number>
  /**
   * Start a background loop calling `drainOnce` every `intervalMs`; returns a stop fn. The loop
   * is the ONLY timer — tests call `drainOnce` directly and advance the FakeClock, so the retry
   * schedule is deterministic (no real sleeping).
   */
  start(intervalMs: number): () => void
}

/**
 * The backoff the worker schedules. Normally the pure `nextBackoff`. The `CHAOS_WEBHOOK_NO_CAP`
 * toggle (deliberate-bug demo) drops the `max_delay_ms` ceiling so the delay grows unbounded —
 * the retry-contract property catches it; redeploy without the toggle to go green.
 */
function computeBackoff(attempt: number, randomness: Randomness): number | null {
  if (attempt >= WEBHOOK_RETRY_POLICY.max_attempts) return null
  if (chaosEnabled('CHAOS_WEBHOOK_NO_CAP')) {
    const uncapped =
      WEBHOOK_RETRY_POLICY.base_delay_ms * WEBHOOK_RETRY_POLICY.multiplier ** (attempt - 1)
    return Math.floor(randomness.next() * uncapped)
  }
  return nextBackoff(attempt, randomness)
}

/**
 * The delivery worker (Milestone 11, ADR-0019) — relay-shaped, mirroring @qaroom/messaging's
 * outbox relay. Each `drainOnce` claims due rows `FOR UPDATE SKIP LOCKED`, drives the
 * webhook-delivery state machine through the runner (so every transition emits an
 * `xstate.transition` span for reverse-conformance), signs + POSTs via the injected
 * `WebhookSender`, and on failure schedules the deterministic backoff or dead-letters.
 */
export function createDeliveryWorker(deps: WorkerDeps): DeliveryWorker {
  const batch = DEFAULT_BATCH
  const sink: WebhookDeliveryTransitionSink | undefined = deps.deliverySink

  function deliveryHeaders(
    deliveryId: string,
    eventId: string,
    ts: string,
    body: string,
    secret: string,
  ) {
    // CHAOS_WEBHOOK_SIGN_BODY_ONLY (deliberate-bug demo): sign the body without binding the
    // timestamp, so a captured (body, signature) pair replays forever. The signature property
    // test catches it.
    const signature = chaosEnabled('CHAOS_WEBHOOK_SIGN_BODY_ONLY')
      ? `v1=${createHmac('sha256', secret).update(body).digest('hex')}`
      : signWebhook(secret, ts, body)
    // CHAOS_WEBHOOK_UNSTABLE_DELIVERY_ID (deliberate-bug demo): a fresh id per attempt, so a
    // deduping receiver cannot recognise a redelivery. The receiver-idempotency property catches it.
    const idHeader = chaosEnabled('CHAOS_WEBHOOK_UNSTABLE_DELIVERY_ID')
      ? deps.ids.next('whdel')
      : deliveryId
    return {
      [WEBHOOK_SIGNATURE_HEADER]: signature,
      [WEBHOOK_TIMESTAMP_HEADER]: ts,
      [WEBHOOK_DELIVERY_ID_HEADER]: idHeader,
      [WEBHOOK_EVENT_ID_HEADER]: eventId,
    }
  }

  async function persist(
    tx: SqlExecutor,
    id: string,
    status: WebhookDeliveryStateName,
    attempt: number,
    nextAttemptAt: string | null,
    lastStatusCode: number | null,
    nowIso: string,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE webhook_deliveries
      SET status = ${status}, attempt = ${attempt}, next_attempt_at = ${nextAttemptAt},
          last_status_code = ${lastStatusCode}, updated_at = ${nowIso}::timestamptz
      WHERE id = ${id}
    `)
  }

  async function attemptOne(tx: SqlExecutor, row: DueRow): Promise<void> {
    // url/secret arrive on the claim row from the JOIN; the claim filters subscription status =
    // 'Active', so a paused/disabled/deleted subscription's deliveries are never claimed (they park
    // until the subscription is re-activated) — paused endpoints receive nothing, in-flight included.
    const now = deps.clock.now()
    const nowIso = now.toISOString()

    applyWebhookDeliveryEvent(row.status, 'AttemptStarted', { clock: deps.clock, sink })

    const envelope = {
      delivery_id: row.id,
      event_id: row.event_id,
      event_type: row.event_type,
      community_id: row.community_id,
      delivered_at: nowIso,
      data: row.payload,
    }
    const body = JSON.stringify(envelope)
    const headers = deliveryHeaders(row.id, row.event_id, nowIso, body, row.secret)
    const result = await deps.sender.send({ url: row.url, body, headers })

    if (isDelivered(result)) {
      // CHAOS_WEBHOOK_ILLEGAL_TRANSITION (deliberate-bug demo): emit an OFF-MODEL transition
      // (row.status → Delivered, skipping Delivering) instead of driving the legal edge through
      // the machine. The endpoint still looks healthy, but reverse-conformance catches the span
      // that is not a legal edge of the hand-authored machine.
      if (chaosEnabled('CHAOS_WEBHOOK_ILLEGAL_TRANSITION') && sink) {
        sink.record({ from: row.status, to: 'Delivered', event: 'DeliverySucceeded', at: nowIso })
      } else {
        applyWebhookDeliveryEvent('Delivering', 'DeliverySucceeded', { clock: deps.clock, sink })
      }
      const code = result.kind === 'success' ? result.status : null
      await persist(tx, row.id, 'Delivered', row.attempt, null, code, nowIso)
      // A success ends the dead-letter streak.
      await tx.execute(sql`
        UPDATE webhook_subscriptions
        SET consecutive_dead_letters = 0, updated_at = ${nowIso}::timestamptz
        WHERE id = ${row.subscription_id} AND consecutive_dead_letters <> 0
      `)
      return
    }

    // CHAOS_WEBHOOK_DROP_ON_FAIL (deliberate-bug demo): mark a FAILED send as Delivered, silently
    // dropping the event instead of retrying. The at-least-once property catches it.
    if (chaosEnabled('CHAOS_WEBHOOK_DROP_ON_FAIL')) {
      applyWebhookDeliveryEvent('Delivering', 'DeliverySucceeded', { clock: deps.clock, sink })
      await persist(tx, row.id, 'Delivered', row.attempt, null, null, nowIso)
      return
    }

    const lastCode = result.kind === 'http_error' ? result.status : null
    const delay = computeBackoff(row.attempt + 1, deps.randomness)
    if (delay !== null) {
      applyWebhookDeliveryEvent('Delivering', 'DeliveryFailed', { clock: deps.clock, sink })
      const nextAtDate = dateFromEpochMillis(now.getTime() + delay)
      await persist(
        tx,
        row.id,
        'Retrying',
        row.attempt + 1,
        nextAtDate.toISOString(),
        lastCode,
        nowIso,
      )
      return
    }

    applyWebhookDeliveryEvent('Delivering', 'RetriesExhausted', { clock: deps.clock, sink })
    await persist(tx, row.id, 'DeadLettered', row.attempt + 1, null, lastCode, nowIso)
    // Increment the streak, and auto-quarantine (→ Disabled) once it hits the threshold.
    await tx.execute(sql`
      UPDATE webhook_subscriptions
      SET consecutive_dead_letters = consecutive_dead_letters + 1,
          status = CASE
            WHEN consecutive_dead_letters + 1 >= ${DISABLE_AFTER_CONSECUTIVE_DEAD_LETTERS} THEN 'Disabled'
            ELSE status
          END,
          updated_at = ${nowIso}::timestamptz
      WHERE id = ${row.subscription_id}
    `)
  }

  async function drainOnce(): Promise<number> {
    const nowIso = deps.clock.now().toISOString()
    return deps.db.transaction(async (tx) => {
      const due = rowsOf<DueRow>(
        await tx.execute(sql`
          SELECT d.id, d.subscription_id, d.community_id, d.event_id, d.event_type, d.payload,
                 d.status, d.attempt, s.url, s.secret
          FROM webhook_deliveries d
          JOIN webhook_subscriptions s ON s.id = d.subscription_id
          WHERE d.status IN ('Pending', 'Retrying')
            AND d.next_attempt_at <= ${nowIso}::timestamptz
            AND s.status = 'Active'
          ORDER BY d.next_attempt_at
          FOR UPDATE OF d SKIP LOCKED
          LIMIT ${batch}
        `),
      )
      let attempted = 0
      for (const row of due) {
        await withTenant(row.community_id, () => attemptOne(tx, row))
        attempted += 1
      }
      return attempted
    })
  }

  function start(intervalMs: number): () => void {
    // The timer shell (only-timer + unref + a swallowed failed tick — a drain failure just leaves
    // rows due for the next pass, at-least-once) is owned by createDrainLoop; the explicit `traced`
    // wrap stays here so the worker keeps its own drain span.
    return createDrainLoop(intervalMs, () => traced('webhooks.worker.drain', () => drainOnce()))
  }

  return { drainOnce, start }
}
