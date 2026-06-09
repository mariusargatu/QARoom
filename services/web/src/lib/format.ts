/**
 * Display formatters. Deliberately avoid `new Date()` / `Date.now()` (the determinism lint bans
 * them even in browser `.ts`, Commitment 6): dates are rendered by slicing the ISO-8601 string, so
 * formatting is a pure function of its input with no ambient clock.
 */

const moneyFmt = new Map<string, Intl.NumberFormat>()

export function formatMoney(amountCents: number, currency: string): string {
  let fmt = moneyFmt.get(currency)
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency })
    } catch {
      // An invalid/unknown currency code makes Intl.NumberFormat throw RangeError; fall back to a
      // plain amount so malformed server data can never crash a render.
      return `${(amountCents / 100).toFixed(2)} ${currency}`
    }
    moneyFmt.set(currency, fmt)
  }
  return fmt.format(amountCents / 100)
}

/** `2026-05-28T12:00:00.000Z` → `2026-05-28`. */
export function formatDate(iso: string): string {
  return iso.slice(0, 10)
}

/** `2026-05-28T12:00:00.000Z` → `2026-05-28 12:00`. */
export function formatDateTime(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`
}

/**
 * Compact a branded id for display: `user_01KTKPMB…267EZN` → `user_…7EZN`. The feed has no
 * by-handle lookup, so a post's author shows as its id; this keeps the meta line calm.
 */
export function shortId(id: string): string {
  const sep = id.indexOf('_')
  if (sep < 0 || id.length <= sep + 9) return id
  return `${id.slice(0, sep + 1)}…${id.slice(-4)}`
}
