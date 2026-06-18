import type { JsMsg } from '@nats-io/jetstream'
import type { NatsHandle } from './connection'
import { ensureConsumer } from './connection'
import { type ResilientConsumeOpts, runResilientConsume } from './consume-loop'

/**
 * Bootstrap a durable JetStream consumer and run the resilient consume loop over it. Folds the
 * `ensureConsumer -> consumers.get -> consume -> runResilientConsume` sequence that the donations,
 * webhooks and gateway consumers each hand-rolled — and which carries a real ordering footgun:
 * `consumers.get` throws `ConsumerNotFound` unless `ensureConsumer` ran first. Doing both here makes
 * that mis-ordering impossible to express. Callers keep their own `handle`/`settle` policy (the
 * gateway's `seen`-set + SyntaxError poison rule stays in its closure) and just pass the loop opts.
 */
export async function consumeDurable(
  handle: NatsHandle,
  durableOpts: { stream: string; durable: string; filterSubjects?: string[] },
  loop: Omit<ResilientConsumeOpts<JsMsg>, 'messages'>,
): Promise<() => Promise<void>> {
  await ensureConsumer(handle, durableOpts)
  const consumer = await handle.js.consumers.get(durableOpts.stream, durableOpts.durable)
  return runResilientConsume<JsMsg>({ ...loop, messages: await consumer.consume() })
}
