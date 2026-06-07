# ADR 0007: Communities-as-tenants and the shared-schema discriminator

- **Status:** Accepted
- **Date:** 2026-06-03
- **Records:** how communities are realized as tenants in Milestone 2: the shared-schema `community_id` discriminator, where the registry lives, and the reserved id of the well-known general community. Implements ADR-0001 Commitment 9; does not modify it.

## Context

Commitment 9 fixes the *what*, "communities are tenants; shared schema + `community_id` discriminator; isolation is a property, verified by fast-check", but not the *where*. Milestone 1 already carries `community_id` as a notNull discriminator on `content.posts` (the seam), and the RFC 7807 enum already reserves a `tenant_resolution` failure domain that nothing produces yet. Milestone 2 must decide: who owns the community registry and membership, and what the default "general" community's id actually is.

Two sub-decisions had real blast radius:

1. **Registry ownership.** `tenant_resolution` ("the community does not exist, or the caller is not a member") implies a source of truth for community existence + membership. Putting it in content-service would scatter tenancy truth across every data-owning service; leaving communities implicit (format-checked ids only) leaves `tenant_resolution` unexercised.
2. **The general community's id.** The roadmap exit criterion says Milestone-0 rows are backfilled to `community_id = comm_general`. But `comm_general` cannot satisfy the branded `CommunityId` pattern `^comm_[0-9A-HJKMNP-TV-Z]{26}$`, it is not 26 Crockford characters, and "general" even contains the excluded letter `L`. Honoring the literal string would force widening the parser, which ripples into the OpenAPI `pattern`, Schemathesis fuzzing, the param-pattern guard test, and `ids.test.ts`.

## Decision

**identity-service owns the registry.** `communities` and `memberships` tables live in identity-service. It seeds the general community and is the single source of truth the `tenant_resolution` failure domain checks: `addMembership` and `listMembers` return 404 `tenant_resolution` for an unknown community, distinct from a missing user (`not_found`). A user's memberships are carried into the JWT as a `memberships` claim, so downstream tenant checks need no synchronous identity call. content-service stays a pure `community_id` consumer.

**The general community is a reserved branded id, not the literal string.** `COMM_GENERAL = CommunityId.parse('comm_00000000000000000000000000')` (exported from `@qaroom/contracts`), with the human-facing name carried in `slug = 'general'`. The roadmap's "comm_general" maps to the slug; storage uses the parseable id. The content-service backfill normalizes any `community_id` that fails the branded pattern to `COMM_GENERAL`, and a verify step asserts every distinct `posts.community_id` parses through `CommunityId.parse()` (the exit criterion, satisfied with zero parser change).

Isolation remains a **property**: `services/identity/src/tenancy.property.test.ts` generates membership operations across two communities and asserts no read returns the other tenant's data. A broken community filter fails on the first generated case.

## Consequences

### Positive

- One source of truth for tenancy; `tenant_resolution` finally has a producer and a contract example.
- The branded-ID invariant stays pristine: no special-case literal in the parser, no carve-out in `ids.test.ts` or the round-trip generator, no widened OpenAPI pattern for fuzzers to disagree with.
- The general community is discoverable by its stable slug while its stored id obeys the same rule as every other id.

### Negative / trade-offs accepted

- `comm_00000000000000000000000000` is not human-readable; readers must know the slug `general` is the friendly handle. Documented in `services/identity/AGENTS.md` and the seed migration.
- identity-service grows beyond "users + JWT" to hold the community registry. Justified: tenancy truth belongs with the issuer of membership claims.
- The content backfill is forward data-normalization; its reversibility is bounded (an audit table restores prior values). The reversibility/idempotency *star* is identity's DDL migration, which is fully reversible.

## Rejected alternatives

- **Widen `CommunityId` to accept the literal `comm_general`** (`z.union([branded, z.literal('comm_general')])`), rejected for blast radius: it forces the OpenAPI `pattern`, Schemathesis, the param-pattern guard, and `ids.test.ts` to all special-case one value, eroding "the parser is the single source of the id shape".
- **Communities implicit (format-only `community_id`, no registry)**, smaller, but leaves `tenant_resolution` with no producer and no way to reject a non-existent tenant; isolation would have nothing authoritative to test against.
- **Registry in content-service**: scatters tenancy truth across data-owning services and couples every future service to content for existence checks.

## Related decisions

- [ADR-0001](0001-foundational-decisions.md): Commitment 9 (communities-as-tenants), Commitment 13 (`tenant_resolution`).
- [ADR-0008](0008-jwt-signing-key-model-and-rotation-contract.md): the JWT that carries the `memberships` claim derived from this registry.
- `docs/04-roadmap.md`: Milestone 2 exit criteria.
