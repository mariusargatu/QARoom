/** Resolve after `ms` (wall-clock; chaos runs against the real cluster, not logical time). */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
