/**
 * Parse a positive-integer environment variable, falling back when it is unset, empty/blank, or
 * not a positive finite number.
 *
 * Plain `Number(process.env.X)` is a trap: `Number("")===0`, `Number("  ")===0`,
 * `Number("abc")===NaN` — and a `!== undefined` / `??` guard only catches *unset*, never the
 * empty string. An env templated to `""` (a common Helm/k8s outcome) therefore silently collapses
 * to `0` (an instant-abort timeout, a `max:0` pool, a random port). This rejects all of those and
 * returns the fallback instead.
 */
export function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}
