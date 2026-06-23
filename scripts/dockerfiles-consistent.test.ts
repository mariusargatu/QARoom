import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The 7 service Dockerfiles repeat the same builder prologue + workspace install. We deliberately do
// NOT dedup them into a shared base image (that adds a build-ordering dependency to the k3d/Tilt and
// CI build that is not worth it in a demo repo). Instead, guard the one drift that the duplication
// makes silent: a service left on `--frozen-lockfile=false` while the rest are reproducible. This
// runs under vitest.scripts.config.ts and gates PRs via `pnpm test:scripts`.
// ponytail: guard, not dedup — promote to a shared base image only if the prologue starts to diverge.
const ROOT = resolve(__dirname, '..')
const SERVICES = resolve(ROOT, 'services')
// Only the pnpm/Node services. moderator-agent is the one Python service (uv sync --frozen) and has
// no `pnpm install` line, so it is correctly out of scope for this lockfile guard.
const pnpmDockerfiles = readdirSync(SERVICES)
  .map((svc) => resolve(SERVICES, svc, 'Dockerfile'))
  .filter((p) => existsSync(p) && readFileSync(p, 'utf8').includes('pnpm install'))

describe('pnpm service Dockerfiles stay consistent', () => {
  it('finds every pnpm service Dockerfile (guard is not vacuously green)', () => {
    expect(pnpmDockerfiles.length).toBeGreaterThanOrEqual(7)
  })

  it.each(
    pnpmDockerfiles.map((p) => [p.replace(`${ROOT}/`, ''), p] as const),
  )('%s installs with a frozen lockfile (reproducible, never `--frozen-lockfile=false`)', (_label, path) => {
    const text = readFileSync(path, 'utf8')
    expect(text).toContain('pnpm install --frozen-lockfile')
    expect(text).not.toContain('--frozen-lockfile=false')
  })
})
