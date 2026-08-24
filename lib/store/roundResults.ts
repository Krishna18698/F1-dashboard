/**
 * Durable store for a finished round's classification and championship points.
 *
 * WHY THIS EXISTS
 * The results stop changing at the chequered flag — measured against the Dutch GP archive, the
 * top-five order is byte-identical from lap 70 through the end of the session. So holding a
 * WebSocket open for hours afterwards fetches nothing new; it only exists because a serverless
 * cold start has no memory of the race and has to re-read the same values to fill the ticker.
 *
 * Storing the final snapshot once removes that reason, which lets the socket close shortly
 * after the flag instead of hours later.
 *
 * WHY NOT SQLITE
 * A SQLite file cannot work here. Vercel's filesystem is ephemeral and per-invocation: only
 * /tmp is writable, it is not shared between lambdas, and it is wiped on cold start. The
 * database would work perfectly in local dev and silently lose every race in production.
 * Supabase is Postgres over HTTP, which survives both.
 *
 * DEGRADES CLEANLY
 * With no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY configured every function here becomes a
 * no-op returning null, and the app behaves exactly as it did before: socket first, archive
 * second, Jolpica last. Nothing breaks, the snapshot is simply not kept.
 */
import "server-only";

/** One driver's finishing position, as classified at the flag. */
export interface StoredPlace {
  pos: number;
  tla: string;
}

export interface RoundResult {
  round: number;
  /** e.g. "Dutch Grand Prix · Race" — also tells a sprint from a Grand Prix. */
  sessionName: string;
  /** Final classification, provisional until the stewards are done. */
  places: StoredPlace[];
  /** When this snapshot was taken (epoch ms). */
  capturedAt: number;
  /** Set once the post-race re-check has run, so it only runs once. */
  recheckedAt: number | null;
}

const TABLE = "round_result";

function config(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return url && key ? { url: url.replace(/\/+$/, ""), key } : null;
}

/** True when a durable store is available — callers use it to decide whether to bother. */
export function roundStoreConfigured(): boolean {
  return config() !== null;
}

function headers(key: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

/** The stored snapshot for a round, or null if there is none (or no store). */
export async function getRoundResult(round: number): Promise<RoundResult | null> {
  const c = config();
  if (!c || !Number.isFinite(round) || round < 1) return null;
  try {
    const res = await fetch(`${c.url}/rest/v1/${TABLE}?round=eq.${round}&select=*`, {
      headers: headers(c.key),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as {
      round: number;
      session_name: string;
      places: StoredPlace[];
      captured_at: number;
      rechecked_at: number | null;
    }[];
    const r = rows[0];
    if (!r?.places?.length) return null;
    return {
      round: r.round,
      sessionName: r.session_name,
      places: r.places,
      capturedAt: Number(r.captured_at),
      recheckedAt: r.rechecked_at == null ? null : Number(r.rechecked_at),
    };
  } catch {
    return null;
  }
}

/**
 * Write (or overwrite) a round's snapshot. Returns false when there is no store configured or
 * the write failed — never throws, because a failed snapshot must not take a page render with
 * it. The caller still has the socket's own answer in hand.
 */
export async function saveRoundResult(
  r: Omit<RoundResult, "capturedAt" | "recheckedAt"> & { recheckedAt?: number | null },
): Promise<boolean> {
  const c = config();
  if (!c || !r.places.length) return false;
  try {
    const res = await fetch(`${c.url}/rest/v1/${TABLE}?on_conflict=round`, {
      method: "POST",
      headers: headers(c.key, { Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify({
        round: r.round,
        session_name: r.sessionName,
        places: r.places,
        captured_at: Date.now(),
        rechecked_at: r.recheckedAt ?? null,
      }),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}
