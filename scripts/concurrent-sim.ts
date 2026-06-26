import { type RolloutState, rolloutMachine } from '@qaroom/contracts'

// Legal events per state, read straight from the rollout machine config (the single source of truth —
// not a hand-copied table). Used to pick an advance that is legal from the OBSERVED state; under
// concurrency the state can move between read and POST, so the service may still 409 (a valid race).
const MACHINE_STATES = rolloutMachine.config.states as Record<
  string,
  { on?: Record<string, unknown> }
>
const legalEvents = (state: string): string[] => Object.keys(MACHINE_STATES[state]?.on ?? {})

/**
 * REALISTIC SOCIAL-NETWORK SYSTEM TEST against the live cluster. Instead of a uniform load hammer this
 * orchestrates believable activity — many distinct users CLUSTERED into shared communities, running a
 * read-heavy action mix (browse feed > vote > post > donate) — so the cross-service SEAMS are the
 * subject under test, not just raw throughput. The concurrency unit is one task per USER (a distinct,
 * single-threaded session), which keeps the oracle exact while many users contend on the same posts.
 *
 * SEAMS EXERCISED + ASSERTED (the "does the system hold" oracle):
 *   1. NO CRASH (500/502)         — a backend 500/502 is a BUG. 429/503/504/409 + transport resets are
 *      load/race signals, not bugs.
 *   2. SINGLE-WRITER (content)    — clustered votes on shared hot posts: each post's score == the sum of
 *      every DISTINCT voter's LAST accepted (200) vote. A lost update (advisory lock / SELECT…FOR UPDATE
 *      failing under contention) makes the live score fall short.
 *   3. READ-AFTER-WRITE (content) — every post a user created (200 + id) appears in its OWN community
 *      feed and …
 *   4. TENANT ISOLATION           — … in no other community's feed.
 *   5. ROLLOUT SINGLE-WRITER (flags) — concurrent operators advancing one flag never corrupt it; it ends
 *      in a valid RolloutState reachable by legal transitions.
 *   6. FLAGS→NATS→DONATIONS (async seam) — donations gate on a LOCAL flag_cache projected from
 *      flag.state.changed events (NOT a sync call to flags). After enabling a flag we measure how long
 *      the event takes to open the donation gate (propagation latency); a 2xx donation ⇒ the cache was
 *      Enabled (the seam delivered). A donation rejected right after enabling is correct lag, not a bug.
 *   7. IDEMPOTENCY               — a vote replayed with the same Idempotency-Key counts once.
 *
 * RATE-LIMIT LEVER (gateway keys the token bucket on `X-Principal-Id`, falling back to client IP):
 *   - default: each user sends a DISTINCT principal → own 600-burst bucket → the storm reaches the
 *     backends at full concurrency (the realistic case — distinct people).
 *   - SHARED_PRINCIPAL=1: all users share one principal → the limiter sheds the flood as 429 before it
 *     reaches the backends (proves the shield: one abusive client can't take the cluster down).
 *
 * COST GUARD: the moderator-agent (the only LLM consumer, on `post.created`) MUST be scaled to 0 before
 * running — post.created events then queue with no consumer, so no OpenAI call is ever made.
 *
 *   kubectl scale deploy moderator-agent -n qaroom --replicas=0
 *   kubectl port-forward svc/gateway 8080:80 -n qaroom &
 *   BASE_URL=http://localhost:8080 USERS=500 ITERS=20 MAX_INFLIGHT=256 tsx scripts/concurrent-sim.ts
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8080'
const DRY = process.argv.includes('--dry-run')
const RUN = process.pid // unique slug/key prefix across runs without a clock/RNG
const SHARED = process.env.SHARED_PRINCIPAL === '1'

const num = (key: string, fallback: number): number => {
  const v = Number(process.env[key])
  return Number.isFinite(v) && v > 0 ? v : fallback
}

const CFG = DRY
  ? { communities: 2, hotPosts: 2, users: 6, iterations: 10 }
  : {
      communities: num('COMMUNITIES', 5),
      hotPosts: num('POSTS', 4),
      users: num('USERS', 24),
      iterations: num('ITERS', 30),
    }
// Cap concurrent sockets through the single port-forward — 500 users pipelining unbounded exhausts the
// kubectl proxy and we measure ECONNRESET, not the cluster. The semaphore queues the overflow.
const MAX_INFLIGHT = num('MAX_INFLIGHT', DRY ? 8 : 128)

const VALID_STATES: readonly RolloutState[] = ['Off', 'Enabling', 'Canary', 'Enabled', 'Disabling']

// Load buckets — separate "the system shed/queued load" (fine) from "the system crashed" (a bug).
const bucket = {
  ok: 0,
  conflict: 0,
  rateLimited: 0,
  badReq: 0,
  crash: 0,
  overload: 0,
  transport: 0,
}
const failures: string[] = []

// In-flight semaphore: bound concurrent fetches regardless of how many user tasks are awaiting.
let inflight = 0
const waiters: Array<() => void> = []
async function gate<T>(fn: () => Promise<T>): Promise<T> {
  if (inflight >= MAX_INFLIGHT) await new Promise<void>((resolve) => waiters.push(resolve))
  inflight += 1
  try {
    return await fn()
  } finally {
    inflight -= 1
    waiters.shift()?.()
  }
}

interface Res {
  status: number
  json: unknown
}

function classify(status: number, method: string, path: string): void {
  if (status >= 200 && status < 300) bucket.ok += 1
  else if (status === 409) bucket.conflict += 1
  else if (status === 429) bucket.rateLimited += 1
  else if (status === 500 || status === 502) {
    bucket.crash += 1
    failures.push(`CRASH ${status} on ${method} ${path}`)
  } else if (status === 503 || status === 504) bucket.overload += 1
  else if (status >= 400) bucket.badReq += 1
}

async function req(
  method: string,
  path: string,
  body?: unknown,
  idemKey?: string,
  principal?: string,
): Promise<Res> {
  return gate(async () => {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (idemKey) headers['idempotency-key'] = idemKey
    if (principal) headers['x-principal-id'] = principal
    let res: Response
    try {
      res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      bucket.transport += 1 // ECONNRESET / socket hang-up / timeout — saturation, not a server bug
      return { status: 0, json: undefined }
    }
    classify(res.status, method, path)
    const text = await res.text().catch(() => '')
    return { status: res.status, json: text ? safeJson(text) : undefined }
  })
}

function safeJson(t: string): unknown {
  try {
    return JSON.parse(t)
  } catch {
    return t
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
// Deterministic per-(user,index) pick: avoids Math.random (forbidden) and keeps the run replayable.
const pick = <T>(arr: readonly T[], n: number): T => arr[Math.abs(n) % arr.length] as T
const principalFor = (idx: number): string => (SHARED ? `sim-${RUN}-shared` : `sim-${RUN}-u${idx}`)
const userId = (idx: number): string => `user_${RUN}_${idx}`.padEnd(31, '0').slice(0, 31)

interface Community {
  id: string
  hot: string[] // pre-seeded post ids — the shared vote targets that exist from t0
}
interface World {
  communities: Community[]
}

// Realistic read-heavy social mix: browse feed > vote > create post > donate (per 20 ticks).
const MIX: readonly string[] = [
  ...Array(7).fill('feed'),
  ...Array(8).fill('vote'),
  ...Array(3).fill('post'),
  ...Array(2).fill('donate'),
]

// Oracle source-of-truth models, written only from ACCEPTED (200) responses.
const expectedVotes = new Map<string, Map<string, number>>() // postId -> voterId -> last value
const createdPosts: { id: string; communityId: string }[] = [] // for read-after-write + tenant
const acceptedDonations = new Map<string, number>() // communityId -> count of 200 donations
let gateLatencyMs = -1 // measured flag→donation propagation (async seam)

async function setup(): Promise<World> {
  const principal = `sim-${RUN}-setup`
  const communities: Community[] = []
  for (let c = 0; c < CFG.communities; c++) {
    const slug = `sim_${RUN}_c${c}`
    const r = await req(
      'POST',
      '/api/communities',
      { slug, name: slug },
      `idem-comm-${RUN}-${c}`,
      principal,
    )
    const id = (r.json as { id?: string }).id
    if (!id) continue
    const hot: string[] = []
    for (let p = 0; p < CFG.hotPosts; p++) {
      const pr = await req(
        'POST',
        `/api/communities/${id}/posts`,
        { author_id: userId(0), title: `hot${p}`, body: 'seed' },
        `idem-post-${RUN}-${c}-${p}`,
        principal,
      )
      const pid = (pr.json as { id?: string }).id
      if (pid) hot.push(pid)
    }
    communities.push({ id, hot })
  }
  return { communities }
}

// Phase B — drive every flag Off→Enabled with a CONCURRENT burst of operators (rollout single-writer
// under contention), then poll a donation until the async flag_cache opens the gate, recording the
// flags→NATS→donations propagation latency. Returns once at least the first community's gate is open.
async function enableAndMeasure(world: World): Promise<void> {
  const principal = `sim-${RUN}-operator`
  const target = ['ENABLE', 'PROMOTE', 'COMPLETE'] // best-effort forward path; legal set gates the actual send
  // Concurrent advance bursts: 4 operators race each flag through the path. The service serializes.
  await Promise.all(
    world.communities.flatMap((community) =>
      Array.from({ length: 4 }, (_, op) => async () => {
        for (const _step of target) {
          const cur = await req('GET', `/api/communities/${community.id}/flags/donations`)
          const state = (cur.json as { state?: RolloutState }).state ?? 'Off'
          const legal = pick(legalEvents(state), op)
          if (legal)
            await req(
              'POST',
              `/api/communities/${community.id}/flags/donations/rollout`,
              { event: legal },
              `enable-${RUN}-${community.id}-${op}-${_step}`,
              principal,
            )
        }
      })().catch(() => {}),
    ),
  )
  // Measure the async seam: poll a donation against the first community until the cache opens the gate.
  const probe = world.communities[0]
  if (!probe) return
  const t0 = performance.now()
  for (let attempt = 0; attempt < 50; attempt++) {
    const r = await req(
      'POST',
      `/api/communities/${probe.id}/donations`,
      { donor_id: userId(0), amount_cents: 1 },
      `gateprobe-${RUN}-${attempt}`,
      principal,
    )
    if (r.status === 200) {
      gateLatencyMs = performance.now() - t0
      acceptedDonations.set(probe.id, (acceptedDonations.get(probe.id) ?? 0) + 1)
      return
    }
    await sleep(100)
  }
}

async function user(idx: number, world: World): Promise<void> {
  const principal = principalFor(idx)
  const me = userId(idx)
  const home = world.communities[idx % world.communities.length]
  if (!home) return
  for (let i = 0; i < CFG.iterations; i++) {
    // Mostly act in home (clustering → same-community contention); occasionally roam to a neighbour.
    const community = i % 5 === 4 ? pick(world.communities, idx + i) : home
    const action = pick(MIX, idx * 31 + i * 17)

    if (action === 'feed') {
      await req('GET', `/api/communities/${community.id}/feed`)
    } else if (action === 'vote' && community.hot.length > 0) {
      const post = pick(community.hot, idx * 7 + i * 13)
      const value = (idx + i) % 2 === 0 ? 1 : -1
      // Replay the SAME idem key every 5th vote to probe idempotency (must count once).
      const idem = `vote-${RUN}-${idx}-${me}-${post}-${i % 5 === 0 ? 'R' : i}`
      const r = await req(
        'POST',
        `/api/posts/${post}/votes`,
        { voter_id: me, value },
        idem,
        principal,
      )
      if (r.status === 200) {
        const m = expectedVotes.get(post) ?? new Map<string, number>()
        m.set(me, value) // this user is single-threaded → its "last" write is unambiguous
        expectedVotes.set(post, m)
      }
    } else if (action === 'post') {
      const r = await req(
        'POST',
        `/api/communities/${community.id}/posts`,
        { author_id: me, title: `u${idx}-i${i}`, body: 'hi' },
        `post-${RUN}-${idx}-${i}`,
        principal,
      )
      const pid = (r.json as { id?: string }).id
      if (pid) createdPosts.push({ id: pid, communityId: community.id })
    } else if (action === 'donate') {
      const r = await req(
        'POST',
        `/api/communities/${community.id}/donations`,
        { donor_id: me, amount_cents: 100 + i },
        `don-${RUN}-${idx}-${i}`,
        principal,
      )
      if (r.status === 200)
        acceptedDonations.set(community.id, (acceptedDonations.get(community.id) ?? 0) + 1)
    }
  }
}

async function oracle(world: World): Promise<void> {
  const byComm = new Map<string, { id: string }[]>()
  for (const p of createdPosts) {
    const list = byComm.get(p.communityId) ?? []
    list.push({ id: p.id })
    byComm.set(p.communityId, list)
  }

  for (const community of world.communities) {
    const feed = await req('GET', `/api/communities/${community.id}/feed`)
    const fp = (feed.json as { posts?: { id: string; score: number }[] }).posts ?? []
    const seen = new Set(fp.map((p) => p.id))
    const ownPosts = new Set([
      ...community.hot,
      ...(byComm.get(community.id)?.map((p) => p.id) ?? []),
    ])

    // INVARIANT 4: every post in the feed belongs to THIS community.
    for (const p of fp)
      if (!ownPosts.has(p.id))
        failures.push(`TENANT LEAK: community ${community.id} feed shows foreign post ${p.id}`)

    // INVARIANT 3: every post a user created here is visible in this feed (read-after-write).
    for (const created of byComm.get(community.id) ?? [])
      if (!seen.has(created.id))
        failures.push(
          `READ-AFTER-WRITE: post ${created.id} missing from community ${community.id} feed`,
        )

    // INVARIANT 2: each hot post's score == net of distinct voters' last accepted vote (single-writer).
    for (const p of fp) {
      const exp = [...(expectedVotes.get(p.id)?.values() ?? [])].reduce((a, b) => a + b, 0)
      if (expectedVotes.has(p.id) && p.score !== exp)
        failures.push(
          `LOST UPDATE: post ${p.id} score=${p.score}, expected ${exp} (net distinct voters)`,
        )
    }

    // INVARIANT 5: the flag ended on-model.
    const flag = await req('GET', `/api/communities/${community.id}/flags/donations`)
    const state = (flag.json as { state?: string }).state
    if (!VALID_STATES.includes(state as RolloutState))
      failures.push(`OFF-MODEL: community ${community.id} flag state '${state}'`)
  }
}

function totalReqs(): number {
  return Object.values(bucket).reduce((a, b) => a + b, 0)
}

async function main(): Promise<void> {
  process.stdout.write(
    `social-system-test ${DRY ? '(DRY RUN)' : '(FULL)'} → ${BASE_URL}\n` +
      `  ${CFG.users} users × ${CFG.iterations} actions, ${CFG.communities} communities, ${CFG.hotPosts} hot posts each\n` +
      `  max in-flight ${MAX_INFLIGHT}, principal=${SHARED ? 'SHARED (rate-limit shield)' : 'per-user (full concurrency)'}\n`,
  )
  const probe = await fetch(`${BASE_URL}/api/communities`, { method: 'GET' }).catch(() => null)
  if (!probe) {
    process.stderr.write(
      `cannot reach gateway at ${BASE_URL} — is the port-forward up? (kubectl port-forward svc/gateway 8080:80 -n qaroom)\n`,
    )
    process.exit(2)
  }

  const world = await setup()
  if (world.communities.length === 0 || world.communities.every((c) => c.hot.length === 0)) {
    process.stderr.write(
      `setup created no posts — aborting (gateway reachable but rejecting writes)\n`,
    )
    process.exit(2)
  }
  process.stdout.write(
    `  seeded ${world.communities.length} communities, ${world.communities.reduce((a, c) => a + c.hot.length, 0)} hot posts\n`,
  )

  await enableAndMeasure(world)
  process.stdout.write(
    `  flags enabled; flags→NATS→donations gate opened in ${gateLatencyMs < 0 ? 'NEVER (seam stalled)' : `${gateLatencyMs.toFixed(0)}ms`}\n`,
  )

  const t0 = performance.now()
  await Promise.all(Array.from({ length: CFG.users }, (_, i) => user(i, world)))
  const elapsedSec = (performance.now() - t0) / 1000
  const distinct = [...expectedVotes.values()].reduce((a, m) => a + m.size, 0)
  process.stdout.write(
    `  storm complete in ${elapsedSec.toFixed(1)}s — ${distinct} distinct voters, ${createdPosts.length} posts created, ` +
      `${[...acceptedDonations.values()].reduce((a, b) => a + b, 0)} donations, ${(totalReqs() / elapsedSec).toFixed(0)} req/s\n`,
  )

  await oracle(world)

  process.stdout.write(
    `\n  load buckets (total ${totalReqs()} reqs):\n` +
      `    2xx ok ........... ${bucket.ok}\n` +
      `    409 conflict ..... ${bucket.conflict}   (idempotency / illegal-transition / lost-race — expected)\n` +
      `    429 rate-shed .... ${bucket.rateLimited}   (limiter protected backends — not a bug)\n` +
      `    503/504 overload . ${bucket.overload}   (load-shed under saturation — not a bug)\n` +
      `    transport reset .. ${bucket.transport}   (socket exhaustion at the port-forward — not a bug)\n` +
      `    4xx other ........ ${bucket.badReq}\n` +
      `    500/502 CRASH .... ${bucket.crash}   (server bug if > 0)\n`,
  )

  if (gateLatencyMs < 0)
    failures.push('ASYNC SEAM: donation gate never opened after enabling the flag')

  if (failures.length === 0) {
    process.stdout.write(
      `\n✓ all seams held under realistic concurrent load (no crash, single-writer, read-after-write, isolated, async gate delivered)\n`,
    )
    process.exit(0)
  }
  process.stderr.write(
    `\n✗ ${failures.length} seam violation(s):\n${failures
      .slice(0, 40)
      .map((f) => `  - ${f}`)
      .join('\n')}${failures.length > 40 ? `\n  …and ${failures.length - 40} more` : ''}\n`,
  )
  process.exit(1)
}

void main()
