import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Component-coverage census (ADR-0027). The HARD gate: every atomic-design component
 * (atoms/molecules/organisms/templates) has a CSF-factory story — structural story coverage that the
 * fan-out can't silently regress. The SOFT signal: an interactive component (one whose props include
 * an `on<Handler>`) without a `play()` interaction test is reported, not failed (some handler props
 * are covered by a Screenplay component test instead). Pages are excluded (their flow coverage is the
 * xstate machines + E2E, not stories). Run from services/web:  pnpm --filter @qaroom/web census
 */
const WEB = process.cwd()
const TIERS = ['atoms', 'molecules', 'organisms', 'templates'] as const
const COMPONENTS = resolve(WEB, 'src/components')

interface Finding {
  tier: string
  component: string
  problem: string
}

const hard: Finding[] = []
const soft: Finding[] = []
let components = 0
let withPlay = 0

for (const tier of TIERS) {
  const tierDir = join(COMPONENTS, tier)
  if (!existsSync(tierDir)) continue
  for (const name of readdirSync(tierDir)) {
    const dir = join(tierDir, name)
    if (!statSync(dir).isDirectory()) continue
    const componentFile = join(dir, `${name}.tsx`)
    if (!existsSync(componentFile)) continue
    components += 1

    const storyFile = join(dir, `${name}.stories.tsx`)
    if (!existsSync(storyFile)) {
      hard.push({ tier, component: name, problem: 'no .stories.tsx' })
      continue
    }
    const story = readFileSync(storyFile, 'utf8')
    // Bar 2: CSF factory (ADR-0027 §4). The definitive marker is the `meta.story(` factory call (every
    // story is `export const X = meta.story(...)`), not merely importing the preview path — a CSF3 file
    // that happened to import it would otherwise pass.
    if (!/\bmeta\.story\s*\(/.test(story)) {
      hard.push({
        tier,
        component: name,
        problem: 'story is not a CSF factory (no `meta.story(` call)',
      })
    }

    const hasPlay = /\bplay:\s*async/.test(story)
    if (hasPlay) withPlay += 1
    // Bar 3 (soft): an event-handler prop (`on<Handler>:`) with no play() interaction test. Heuristic —
    // it only sees handler props declared literally in the component, not ones inherited via
    // `extends *HTMLAttributes`; the gap is reported, never fails the build, so a false negative is benign.
    const component = readFileSync(componentFile, 'utf8')
    const interactive = /\bon[A-Z]\w*\??:/.test(component)
    if (interactive && !hasPlay) {
      soft.push({
        tier,
        component: name,
        problem: 'interactive prop but no play() interaction test',
      })
    }
  }
}

const fmt = (f: Finding) => `  ${f.tier}/${f.component}: ${f.problem}`

process.stdout.write(
  `component census — ${components} components, ${withPlay} with a play() interaction test\n`,
)
if (soft.length > 0) {
  process.stdout.write(`\n${soft.length} interaction-coverage gap(s) (reported, not failing):\n`)
  process.stdout.write(`${soft.map(fmt).join('\n')}\n`)
}
if (hard.length > 0) {
  process.stderr.write(
    `\n${hard.length} story-coverage violation(s):\n${hard.map(fmt).join('\n')}\n`,
  )
  process.exit(1)
}
process.stdout.write('\nevery component has a CSF-factory story ✓\n')
