# ADR 0008: JWT signing-key model and rotation contract

- **Status:** Accepted
- **Date:** 2026-06-03
- **Records:** how identity-service signs, publishes, and rotates JWT signing keys in Milestone 2, and why JWT issuance is treated as a tested surface rather than a trusted one. Implements the identity-issuance boundary in `ARCHITECTURE.md` §3; does not modify any ADR-0001 commitment.

## Context

identity-service issues access tokens that the gateway and downstream services will verify. The ecosystem default is to trust issuance (sign with one static key, never rotate, verify with a hardcoded secret) and discover the gaps (accepted-after-expiry, wrong-`kid`, key-not-in-JWKS) only in incidents. QARoom's thesis is that these are *properties* with a contract.

Two forces shaped the decision. First, **determinism (Commitment 6):** token expiry and the rotation grace window must be driven by the injected `Clock`, never wall-clock, or none of it is deterministically testable. Second, **key material is the one unavoidable crypto touch**, and CSPRNG output cannot come from the seeded `Randomness` trio, so it must sit behind an injectable seam, exactly like `SystemClock`.

## Decision

**Algorithm + transport.** ES256 (EC P-256). Keys are stored in identity Postgres **as JWKs** (`signing_keys` table: `kid`, `alg`, `public_jwk`, `private_jwk`, `status`, `created_at`, `retired_at`), and imported at use-time via `importJWK`. Storing JWKs (not live `KeyLike` handles) keeps the model serializable, snapshot-able, and insulated from `jose` v5↔v6 key-type drift.

**Key id.** The `kid` is a branded `KeyId` (`key_<ULID>`) minted from the injected `IdGenerator`, so seeded tests get reproducible kids and the JWKS pact can assert the kid shape with a hand-authored regex.

**JWKS eligibility + rotation.** A partial unique index enforces exactly one `current` key. `rotate()` demotes the current key to `previous` (stamping `retired_at = clock.now()`) and mints a new current. The JWKS-eligible set, published at `GET /jwks.json` and used for verification, is the current key plus every `previous` key still inside its grace window, where eligibility is evaluated as `retired_at + graceMs >= clock.now()` against the **logical** clock. **Grace is 24h in production config, 1h in test config.** A `kid` outside the eligible set is rejected *before* signature verification, so unknown / past-grace / never-published keys all fail uniformly.

**Determinism seam.** Key material comes from an injected `KeyMaterialSource` (`ProductionKeyMaterialSource` calls `jose.generateKeyPair('ES256')`; tests inject a fixed committed ES256 keypair). `jose` is a dependency called with clock-derived numeric inputs (`jwtVerify` is always passed `currentDate: clock.now()`) so no `new Date` / `Math.random` reaches identity `src`, and signatures + JWKS output are byte-reproducible.

**The tested surface.** JWT issuance/validation is verified as properties, not trusted:

1. **Expiry:** a token whose `exp` has passed under the advanced `FakeClock` is rejected as `authentication`.
2. **Unknown `kid`:** a token whose `kid` is not in the JWKS-eligible set is rejected.
3. **Non-JWKS key:** a token signed by a key that was never published is rejected, even when its `kid` matches the live key.
4. **Rotation continuity:** a token issued under the old `kid` still verifies before the grace window closes, and is rejected after (token TTL set far beyond grace so the rejection is attributable to grace, not expiry).
5. **JWKS contract:** a Pact consumer test (gateway -> identity) pins the `GET /jwks.json` shape; identity verifies it as provider against a Testcontainers Postgres seeded with the fixture key.

Gateway JWT *enforcement* (verifying bearer tokens on proxied routes, checking the `memberships` claim against the path community) is **deferred**: it would break existing gateway tests and is not a Milestone-2 exit criterion. The gateway consumes the JWKS contract this milestone; `tenant_resolution` is exercised by identity (ADR-0007).

## Consequences

### Positive

- Rotation is observable (`/system/state` reports `current_kid`, `previous_kids`, `jwks_eligible_count`, `grace_ms`) and replay-safe (logical-clock-driven), so a continuity regression is caught by advancing a fake clock: no real timers, no flakiness.
- Every JWT rejection path is a property with a worked example, not a trusted code path.
- Keys-as-JWKs makes the whole key set snapshot-able for Milestone 7 scenario replay.

### Negative / trade-offs accepted

- Private keys live in the service database. Acceptable for a local-first demo; a production system would use a KMS/HSM behind the same `KeyMaterialSource` seam (the seam is the point: swapping the source needs no call-site change).
- The fixed test keypair is committed in the repo. It is a throwaway demo key, never a production secret, and is what makes JWKS/signature output byte-stable.
- One signing algorithm (ES256). Multi-alg JWKS is a future extension; the `alg` column and JWK `alg` field leave room.

## Rejected alternatives

- **Static single key, no rotation:** the ecosystem default; it makes "accepts expired / wrong-kid / non-JWKS key" untestable and unfixable. Rotation continuity is the headline property of this milestone.
- **HS256 / shared secret:** symmetric secrets cannot be published for independent verification; JWKS exists precisely to avoid sharing signing material.
- **Wall-clock expiry / grace:** would make expiry and rotation non-deterministic and force real-time waits in tests; logical-clock grace is the enabling decision.
- **Generating keys from the seeded `Randomness`:** a fixed PRNG cannot produce sound EC key material; the injected `KeyMaterialSource` with a committed test keypair is the deterministic path.

## Related decisions

- [ADR-0001](0001-foundational-decisions.md): Commitment 6 (determinism), Commitment 13 (RFC 7807 `authentication`).
- [ADR-0007](0007-communities-as-tenants-shared-schema-discriminator.md): the registry whose memberships become the JWT `memberships` claim.
- `ARCHITECTURE.md` §3: the identity-issuance boundary and its testing technique.
