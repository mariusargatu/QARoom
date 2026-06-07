# Spike 1: EvoMaster v6 against TypeScript Fastify

- **Milestone affected:** 8 (search-based fuzzing)
- **Question:** Can EvoMaster drive a TS Fastify service from its OpenAPI (black-box) and
  emit usable test output?
- **Verdict:** ✅ **PASS**

## Method

EvoMaster v6.0.0 (jar, Java 17), black-box mode against the live content-service
(real Postgres) using the committed `openapi.yaml`:

```
java -jar evomaster.jar --blackBox true \
  --schema services/content/openapi.yaml \
  --base http://localhost:8081 \
  --outputFormat JS_JEST --outputFolder ./generated \
  --maxTime 45s --ratePerMinute 240 --schemaOracles true
```

(Note: v6 renamed the old `--bbSwaggerLocation` / `--bbTargetUrl` to `--schema` / `--base`.)

## Result

- Evaluated **151 tests / 179 actions** in a 45s budget; covered 27 targets.
- **Successfully executed (HTTP 2xx) 5 of 6 endpoints (83%)**: including the required
  `Idempotency-Key` header on mutations, which EvoMaster generated from the OAS.
- Emitted **9 runnable Jest tests** (`EvoMaster_successes_Test.js`, `EvoMaster_others_Test.js`,
  `EMTestUtils.js`) plus an HTML coverage report. 0 potential faults.

The one endpoint not driven to 2xx is `castVote` (needs a pre-existing post; pure
black-box without a create->vote sequence returns 404), expected, and exactly what the
stateful tools (Schemathesis links) cover.

## Consequence

EvoMaster is viable for Milestone 8 search-based fuzzing of the TS services in black-box mode.
The JS_JEST output integrates with the existing Vitest/Jest tooling. No ADR amendment;
the Milestone 8 fallback (substitute Schemathesis stateful-links) is not needed.
