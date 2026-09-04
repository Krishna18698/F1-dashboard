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
