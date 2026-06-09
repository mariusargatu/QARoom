import { WsEnvelope } from '@qaroom/contracts'
import { recordOnActiveSpan } from '@qaroom/otel'

type Listener = (envelope: WsEnvelope) => void

/** Distributive omit so `seq` is dropped from EACH member of the WsEnvelope union, not the merge. */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never

/** A frame to publish: an envelope without its `seq` (the stream assigns it). */
export type FrameInput = DistributiveOmit<WsEnvelope, 'seq'>

/**
 * The single source the gateway's WebSocket push and polling fallback both read from
 * (Commitment 11). Publishing assigns a per-community monotonic `seq`, appends to a bounded
 * per-community buffer, AND notifies live subscribers with the SAME envelope — so the set a WS
 * client receives and the set polling returns for a window are identical by construction. The
 * parity test asserts exactly that.
 */
export class CommunityEventStream {
  readonly #buffers = new Map<string, WsEnvelope[]>()
  readonly #seqs = new Map<string, number>()
  readonly #listeners = new Map<string, Set<Listener>>()
  readonly #cap: number

  constructor(cap = 1000) {
    this.#cap = cap
  }

  /** Assign the next per-community `seq`, store, notify subscribers, and return the envelope. */
  publish(frame: FrameInput): WsEnvelope {
    const communityId = frame.community_id
    const seq = (this.#seqs.get(communityId) ?? 0) + 1
    this.#seqs.set(communityId, seq)
    const envelope = WsEnvelope.parse({ ...frame, seq })

    // Append immutably and keep only the last `#cap` (publishes are rare per-community events,
    // so the copy is immaterial; this honours the repo's no-mutation rule).
    const buffer = [...(this.#buffers.get(communityId) ?? []), envelope].slice(-this.#cap)
    this.#buffers.set(communityId, buffer)

    // Notify subscribers defensively: one throwing listener (e.g. a `socket.send` on a
    // closing socket) must not break delivery to the others, nor throw into the publisher —
    // the publisher runs inside the NATS consume loop, and an escaping throw there would skip
    // the message ack. Record the exception on the active span so the failure stays observable.
    for (const listener of this.#listeners.get(communityId) ?? []) {
      try {
        listener(envelope)
      } catch (err) {
        recordOnActiveSpan(err)
      }
    }
    return envelope
  }

  /** Envelopes with `seq` strictly greater than `afterSeq`, oldest first (the polling read). */
  since(communityId: string, afterSeq: number): WsEnvelope[] {
    return (this.#buffers.get(communityId) ?? []).filter((e) => e.seq > afterSeq)
  }

  /** Subscribe a live listener for one community. Returns an unsubscribe function. */
  subscribe(communityId: string, listener: Listener): () => void {
    const set = this.#listeners.get(communityId) ?? new Set<Listener>()
    set.add(listener)
    this.#listeners.set(communityId, set)
    return () => {
      set.delete(listener)
    }
  }
}

/** Parse the polling `?after=<seq>` cursor (defaulting/clamping to 0). Shared by the poll route + WS upgrade. */
export function cursorFromQuery(query: { after?: string }): number {
  const after = Number(query.after ?? 0)
  return Number.isFinite(after) ? after : 0
}
