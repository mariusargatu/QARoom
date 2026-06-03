# Spike 5 — AsyncAPI drift gate (`@asyncapi/diff`)

- **Milestone affected:** 4 (async contract drift gate, Commitment 3)
- **Question:** Does `@asyncapi/diff` have sufficient semantic-diff fidelity to gate
  breaking changes on a sample async contract?
- **Verdict:** ❌ **FAIL (default classification insufficient)** → ADR amendment drafted
  (`docs/adr/0002-asyncapi-drift-gate.md`).

## Method

Isolated eval (`.spikes-tmp/asyncapi/`, `@asyncapi/diff@0.5.0` + `@asyncapi/parser@3.6.0`).
Three AsyncAPI 2.6 contracts for one channel `qaroom.content.posts.created`:
- **base** — payload `{post_id: string, community_id: string}`, both required.
- **breaking** — removed `community_id`, changed `post_id` to `integer`, dropped from required.
- **nonbreaking** — added optional `title`.

## Result

`@asyncapi/diff` **detects** the structural changes but **misclassifies** them. With the
default ruleset, the only change marked `breaking` was `/info/version`; the genuinely
breaking payload changes were `unclassified`:

```
breaking: 1  nonBreaking: 0  unclassified: 3
unclassified remove /channels/.../payload/properties/community_id
unclassified edit   /channels/.../payload/properties/post_id/type
unclassified remove /channels/.../payload/required/1
breaking     edit   /info/version
```

The non-breaking variant ALSO reported `/info/version` as the lone breaking change — so
out of the box the tool keys "breaking" off the version field, not the payload. A custom
`override` ruleset (several path-pattern syntaxes attempted) did not reclassify the
payload changes within the spike's time box; the override matching is under-documented.

## Consequence

Do **not** rely on `@asyncapi/diff`'s built-in classification as the Milestone 4 gate. Its
**detection** is sound (precise JSON-pointer change list), so the recommended approach is
a thin QARoom classifier that consumes `@asyncapi/diff`'s raw change set and applies our
own breaking rules (removal / type-edit under `payload`/`required` ⇒ breaking) — i.e. the
"thin custom check" the ADR-0001 Commitment 3 spike already anticipated. See draft
`docs/adr/0002-asyncapi-drift-gate.md`. No Milestone 0 scope is blocked.
