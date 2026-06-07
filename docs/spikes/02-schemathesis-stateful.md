# Spike 2: Schemathesis stateful workflows (`--phases stateful`)

- **Milestone affected:** 1 (API schema fuzzing)
- **Question:** Does stateful fuzzing produce meaningful sequences against a real OAS that
  declares `links` (create -> retrieve)?
- **Verdict:** ✅ **PASS** (and it found a real contract gap, since fixed)

## Method

Schemathesis 4.20.2 against the live content-service. In v4, stateful is a test milestone:

```
schemathesis run services/content/openapi.yaml --url http://localhost:8081 \
  --phases stateful -H 'Idempotency-Key: schemathesis-run' -n 10
```

The static `Idempotency-Key` header lets mutations reach 2xx so the OAS `links`
(createPost -> getPost, castVote -> getPost) can be followed.

## Result

First run: **`API Links: 8 covered / 8 selected / 8 total (6 inferred)`**, 17 scenarios,
81 cases; Schemathesis discovered and traversed our declared links and inferred more.

It also surfaced a genuine finding:

```
Undocumented HTTP status code: Received: 400, Documented: 200
GET /api/communities/{communityId}/feed   (malformed branded community id)
```

`GET /feed` and `GET /posts/{postId}` parse a branded id from the path and return RFC 7807
**400** on a malformed id, but the spec only documented 200 (+404). This is exactly the
drift stateful fuzzing should catch. **Fixed**: added the 400 response to both GET
operations in `src/operations.ts` and regenerated `openapi.yaml`. Re-run: **17 passed,
79 cases, no issues**.

## Consequence

Stateful `--phases stateful` is viable for Milestone 1; it requires OAS `links` (which our
generator emits on every mutating endpoint) and confirms they resolve. No fallback to
schema-only fuzzing needed. No ADR amendment.
