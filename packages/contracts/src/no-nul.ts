// Postgres `text` cannot store a NUL byte. Encoding "no NUL" as a regex makes the constraint part of
// the OpenAPI `pattern` (so fuzzers don't generate NUL strings and the schema agrees with the API)
// and rejects un-storable input as a clean 400. The pattern uses the `\x00` escape — text, never a
// literal NUL byte. Single source for every live schema's NUL guard, so the rule lives in one place
// (AGENTS.md: "do not re-state a rule in a second place"). The frozen *.v1/*.v2 event baselines keep
// their own inlined copy for byte-stability.
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting the NUL byte is the whole point.
export const NO_NUL = /^[^\x00]*$/
