import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pactProviders } from './lib/pact-artifacts'

/**
 * Coverage census for the Pact ↔ OpenAPI cross-check.
 *
 * The cross-check itself is a per-service spec (`services/<provider>/tests/pact-oas-crosscheck.spec.ts`),
 * which means it is a file someone has to REMEMBER to write. Three of them never were: until
 * 2026-08-11 only content and webhooks had one, so 13 of the 26 committed pact interactions — every
 * identity, donations, and flags expectation — had no per-PR conformance check of any kind
 * (`pact:verify` provider verification is Docker-gated and runs in the nightly `_integration` lane,
 * not on a PR). Adding the three missing files fixes today; this gate fixes tomorrow, by failing
 * when a committed pact names a provider that has no spec.
 *
 * It deliberately checks the FILE exists rather than trusting a hand-maintained provider list —
 * a list is the same "remember to update it" failure mode one level up.
 */
const ROOT = process.cwd()

/** The provider named by each committed pact, deduplicated. Derived, never hand-listed. */
const providersWithCommittedPacts = (): string[] => pactProviders(ROOT)

const crosscheckSpec = (provider: string) =>
  `services/${provider}/tests/pact-oas-crosscheck.spec.ts`

describe('every provider with a committed pact has a Pact ↔ OpenAPI cross-check', () => {
  // Guard the guard: if the pact glob ever returns nothing, every assertion below is vacuously
  // green — the exact failure mode `pact-drift.ts` already defends against for the same artifacts.
  it('finds committed pacts to check (not vacuously green)', () => {
    expect(providersWithCommittedPacts().length).toBeGreaterThan(1)
  })

  it.each(
    providersWithCommittedPacts(),
  )('%s has a cross-check spec covering its committed pact', (provider) => {
    // A provider whose consumers pin expectations, with no spec asserting those expectations are
    // consistent with its PUBLISHED OpenAPI. Nothing else catches it per-PR.
    expect(
      existsSync(resolve(ROOT, crosscheckSpec(provider))),
      `missing ${crosscheckSpec(provider)} — the gateway pins expectations on ${provider} that ` +
        'no per-PR gate compares against its openapi.yaml',
    ).toBe(true)
  })

  // A spec file that stopped loading its pact (renamed constant, wrong path) would still exist and
  // still pass the check above while asserting nothing, so pin the wiring too.
  it.each(
    providersWithCommittedPacts(),
  )("%s's cross-check spec actually reads a pact and calls the cross-check", (provider) => {
    const source = readFileSync(resolve(ROOT, crosscheckSpec(provider)), 'utf8')
    expect(source).toContain('pactInteractions')
    expect(source).toContain('crosscheckInteraction')
  })
})
