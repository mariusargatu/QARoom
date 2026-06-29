# Milestone-0 feasibility spikes

These seven notes are the **provenance trail** for the Milestone 0 spikes. Each is a "question,
verdict, method" memo that de-risked a technique before it was adopted. The *outcomes* long ago
landed in the ADRs and the [detection matrix](../detection-matrix.md); these are kept for the record,
not as current docs. Skim them only if you want to see how a technique was vetted before it earned its
place.

<!-- Frozen at Milestone 0: this set is closed (no new spikes), so the table below is hand-maintained
     on purpose — a generator + drift gate would be machinery for a list that never grows. -->

| Spike | Question it answered |
|---|---|
| [01](01-evomaster.md) | Can EvoMaster fuzz the live API black-box? |
| [02](02-schemathesis-stateful.md) | Does Schemathesis stateful-links follow our OAS `links`? |
| [03](03-pact-oas-crosscheck.md) | Can Pact interactions be cross-checked against the OpenAPI? |
| [04](04-microcks-async-ws.md) | Is Microcks viable for async/WebSocket mocking? |
| [05](05-asyncapi-drift-gate.md) | Can we gate AsyncAPI drift without a first-party differ? |
| [06](06-test-name-rule.md) | Is a lint rule for test-name discipline worth enforcing? |
| [07](07-mbt-edge-coverage.md) | Does model-based testing reach edges examples miss? |
