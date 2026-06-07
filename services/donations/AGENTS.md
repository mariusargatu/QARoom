# donations-service

Per-community donations, gated by the `donations` feature flag and settled through a
(Microcks-mocked) payment provider (Milestone 5). Read the repo-root `AGENTS.md` first; this
service follows the content-service template.

## Endpoints

| Method | Path | operationId | Notes |
|---|---|---|---|
| POST | `/api/communities/{communityId}/donations` | `createDonation` | mutating; `Idempotency-Key`; 409 if flag not enabled; 502 if provider unreachable; OAS `links`->getDonation |
| GET | `/api/communities/{communityId}/donations/{donationId}` | `getDonation` | tenant-scoped; cross-tenant id 404s |
| GET | `/api/communities/{communityId}/donations` | `listDonations` | newest first |
| GET | `/system/state` | `getSystemState` | observable state + `as_of` (Commitment 7) |
| GET | `/system/capabilities` | `getSystemCapabilities` | MCP-tool-shaped (Commitment 7) |

## Feature gating + the payment seam

- **Gating cache:** a NATS consumer (`src/consumer.ts`, subscription `donations.on-flag-state`)
  projects flags-service `flag.state.changed` events into the local `flag_cache` table.
  `createDonation` reads that cache: gating survives a momentary flags-service outage.
- **Payment provider:** `src/payment-client.ts` is the single injectable seam. In-cluster it
  hits the Microcks mock of `payment-provider.openapi.yaml`; tests inject a stub. A provider
  fault (`charge` throws) -> 502 `dependency_failure`; a decline is a recorded `Failed` donation.
- **Events out:** `donation.state.changed` via the transactional outbox (Commitment 17).

## Conventions enforced here

- Amounts are integer minor units (`amount_cents`); never floats.
- Mutations carry `Idempotency-Key` (forwarded to the provider) and declare OAS `links`.
- `community_id` is the tenancy discriminator; reads are tenant-scoped.

## Commands

```bash
pnpm --filter @qaroom/donations dev               # tsx watch (needs Postgres + NATS + payment mock)
pnpm --filter @qaroom/donations test              # vitest (unit + property + consumer)
pnpm --filter @qaroom/donations typecheck
pnpm --filter @qaroom/donations openapi:generate  # regenerate openapi.yaml from Zod + operations
pnpm --filter @qaroom/donations asyncapi:generate # regenerate asyncapi.yaml (send + receive)
```
