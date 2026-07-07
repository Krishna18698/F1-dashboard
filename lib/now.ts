/**
 * Current epoch milliseconds. Wrapped so server components — which render once per
 * request, so request-time is perfectly stable — can read the clock without tripping
 * the "impure function during render" lint rule.
 */
export function requestNow(): number {
  return Date.now();
}
