/**
 * Shared Supabase REST plumbing for the durable stores in this directory.
 *
 * Extracted from roundResults.ts when a second store (sessionResults.ts) needed the same
 * credentials and headers — one place to read the env, so a store can never end up half
 * configured because only one file was updated.
 *
 * Both stores degrade to no-ops when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are absent.
 */
import "server-only";

/** Base URL and service-role key, or null when no store is configured. */
export function storeConfig(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return url && key ? { url: url.replace(/\/+$/, ""), key } : null;
}

export function storeHeaders(key: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

/**
 * One single-row read, so the project registers activity. Supabase pauses a free project after
 * seven days without any, and between race weekends nothing else here touches it: the daily cron
 * bails out with no round long before reaching the database. Paused that way after the 12-day gap
 * between Singapore and Austin 2026. The daily cron calls this first, every day.
 */
export async function touchStore(): Promise<boolean> {
  const c = storeConfig();
  if (!c) return false;
  try {
    const res = await fetch(`${c.url}/rest/v1/round_result?select=round&limit=1`, {
      headers: storeHeaders(c.key),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
