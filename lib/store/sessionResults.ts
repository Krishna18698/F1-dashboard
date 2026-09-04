/**
 * Durable store for the most recently COMPLETED session of any type — practice, qualifying,
 * sprint or race.
 *
 * WHY THIS EXISTS
 * The hero's results ticker keeps a session on screen for 24 h (RESULT_TTL in
 * SessionResults.tsx), but nothing could actually supply one for that long:
 *
 *   - the live socket holds the classification only while its window is open, and that shuts
 *     5 minutes after the session ends (SOCKET_OPEN_AFTER_MS);
 *   - round_result is race-only and keyed by round — it feeds championship points, so a
 *     practice classification must never be written into it;
 *   - F1's static archive publishes hours late. Checked during Italian GP practice: the whole
 *     Italian Grand Prix meeting was still absent from Index.json while FP1 was running, so
 *     the archive fell back to the previous round's race, twelve days old.
 *
 * The result was a ~hours-long hole after every practice and qualifying session where the
 * ticker had nothing to show. This bridges it: capture the classification once while the
 * socket still has it, serve it until something better exists.
 *
 * DEGRADES CLEANLY
 * With no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY configured every function here is a no-op
 * returning null, and the ticker behaves exactly as before — socket, then archive.
 */
import "server-only";
import { storeConfig, storeHeaders } from "./supabase";

/** One row of a session's classification, shaped exactly as the ticker consumes it. */
export interface StoredSessionRow {
  pos: number;
  tla: string;
  team_colour: string;
  best: number | null;
  gap: string;
}

export interface StoredSession {
  session_name: string;
  mode: "race" | "quali" | "practice";
  top: StoredSessionRow[];
  endedAtMs: number;
}

const TABLE = "session_result";

/**
 * The most recently finished session held in the store, or null. Ordered by when the session
 * ENDED rather than when it was captured, so a late backfill can never outrank a newer session.
 */
export async function getLatestSessionResult(): Promise<StoredSession | null> {
  const c = storeConfig();
  if (!c) return null;
  try {
    const res = await fetch(`${c.url}/rest/v1/${TABLE}?select=*&order=ended_at.desc&limit=1`, {
      headers: storeHeaders(c.key),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as {
      session_name: string;
      mode: string;
      top: StoredSessionRow[];
      ended_at: number;
    }[];
    const r = rows[0];
    if (!r?.top?.length) return null;
    return {
      session_name: r.session_name,
      mode: (r.mode as StoredSession["mode"]) ?? "practice",
      top: r.top,
      endedAtMs: Number(r.ended_at),
    };
  } catch {
    return null;
  }
}

/**
 * Upsert a finished session's classification. Keyed by session name, so re-capturing the same
 * session overwrites rather than accumulating. Never throws — a failed snapshot must not take
 * the request with it, and the caller already has the socket's own answer in hand.
 */
export async function saveSessionResult(s: StoredSession): Promise<boolean> {
  const c = storeConfig();
  if (!c || !s.top.length || !Number.isFinite(s.endedAtMs)) return false;
  try {
    const res = await fetch(`${c.url}/rest/v1/${TABLE}?on_conflict=session_name`, {
      method: "POST",
      headers: storeHeaders(c.key, { Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify({
        session_name: s.session_name,
        mode: s.mode,
        top: s.top,
        ended_at: s.endedAtMs,
        captured_at: Date.now(),
      }),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}
