/**
 * Last-completed-session classification from OpenF1 — the FALLBACK under the Supabase session
 * snapshot in /api/f1results.
 *
 * WHY IT EXISTS
 * The Supabase snapshot can only be captured while the live socket is open (5 min after a
 * session ends), which means a session nobody was watching is never stored. OpenF1 retains
 * results independently and publishes them within minutes — measured on Italian GP FP1, it had
 * the full classification 45 minutes after the flag while F1's own archive had not yet
 * published the meeting at all.
 *
 * KNOWN LIMITATION — READ BEFORE RELYING ON THIS
 * The free tier is blocked for the duration of any live F1 session, and the block covers PAST
 * sessions too:
 *
 *   HTTP 401 {"detail":"Live F1 session in progress. Global API access (including past
 *   sessions) is restricted to authenticated users until the session ends."}
 *
 * Verified during the 2026 Italian GP weekend: open between FP1 and FP2, then 401 minutes
 * later. So this tier is unavailable for much of a race weekend — precisely when the gap it
 * fills is widest. It is a genuine fallback, not a fix for the capture problem. Set
 * OPENF1_API_KEY to lift the restriction (paid); without one, a 401 simply returns null and
 * the caller falls through to the round snapshot and then the archive.
 */
import "server-only";

const BASE = "https://api.openf1.org/v1";
/** Results of a finished session never change, so cache hard — it also keeps us well inside
 *  the free tier's rate limit when the ticker polls every 60 s. */
const REVALIDATE = 300;

export interface OpenF1Session {
  session_name: string;
  mode: "race" | "quali" | "practice";
  top: { pos: number; tla: string; team_colour: string; best: number | null; gap: string }[];
  endedAtMs: number;
}

function auth(): Record<string, string> {
  const key = process.env.OPENF1_API_KEY?.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

/**
 * OpenF1 answers errors with a JSON OBJECT ({"detail": ...}) where success is an ARRAY, and
 * uses 401 for the live-session lockout. Anything that is not a non-empty array is "no data".
 */
async function list<T>(path: string): Promise<T[] | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: auth(),
      next: { revalidate: REVALIDATE },
    });
    if (!res.ok) return null;
    const body = await res.json();
    return Array.isArray(body) && body.length ? (body as T[]) : null;
  } catch {
    return null;
  }
}

function modeOf(sessionType: string): OpenF1Session["mode"] {
  const t = sessionType.toLowerCase();
  // Sprint is typed "Race" by OpenF1 exactly as it is by F1's own feed, which is what the rest
  // of the app expects — the ticker reads gaps for a race and lap times for everything else.
  if (t.includes("race")) return "race";
  if (t.includes("qual")) return "quali";
  return "practice";
}

/** Qualifying reports per-segment values as arrays ([Q1, Q2, Q3]); take the last real one. */
function scalar(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (Array.isArray(v)) {
    for (let i = v.length - 1; i >= 0; i--) {
      const n = v[i];
      if (typeof n === "number" && Number.isFinite(n)) return n;
    }
  }
  return null;
}

function gapText(pos: number, raw: unknown): string {
  if (pos === 1) return "";
  const n = scalar(raw);
  if (n != null) return `+${n.toFixed(3)}`;
  // Lapped runners come through as strings like "+1 LAP".
  return typeof raw === "string" ? raw : "";
}

/**
 * The most recently finished session OpenF1 knows about, shaped exactly as the results ticker
 * consumes it. Returns null on any gap — no data, a lockout, or a malformed answer.
 */
export async function openF1LatestResult(): Promise<OpenF1Session | null> {
  const year = new Date().getUTCFullYear();
  const sessions = await list<{
    session_key: number;
    session_name: string;
    session_type: string;
    date_end: string;
    meeting_key: number;
  }>(`/sessions?year=${year}`);
  if (!sessions) return null;

  const now = Date.now();
  const done = sessions
    .map((s) => ({ ...s, endedAtMs: Date.parse(s.date_end) }))
    .filter((s) => Number.isFinite(s.endedAtMs) && s.endedAtMs <= now)
    .sort((a, b) => b.endedAtMs - a.endedAtMs)[0];
  if (!done) return null;

  const [rows, drivers, meetings] = await Promise.all([
    list<{ position: number | null; driver_number: number; duration: unknown; gap_to_leader: unknown }>(
      `/session_result?session_key=${done.session_key}`,
    ),
    list<{ driver_number: number; name_acronym: string; team_colour: string }>(
      `/drivers?session_key=${done.session_key}`,
    ),
    list<{ meeting_key: number; meeting_name: string }>(`/meetings?meeting_key=${done.meeting_key}`),
  ]);
  if (!rows) return null;

  const byNum = new Map((drivers ?? []).map((d) => [d.driver_number, d]));
  const top = rows
    .filter((r) => typeof r.position === "number" && r.position > 0)
    .sort((a, b) => (a.position as number) - (b.position as number))
    .map((r) => {
      const pos = r.position as number;
      const d = byNum.get(r.driver_number);
      return {
        pos,
        tla: d?.name_acronym ?? String(r.driver_number),
        team_colour: (d?.team_colour ?? "").replace(/^#/, ""),
        best: scalar(r.duration),
        gap: gapText(pos, r.gap_to_leader),
      };
    });
  if (!top.length) return null;

  const meeting = meetings?.[0]?.meeting_name;
  return {
    // Match the app's own "<Grand Prix> · <Session>" formatting; fall back to the bare session
    // name rather than printing "undefined ·" if the meeting lookup was the one call that failed.
    session_name: meeting ? `${meeting} · ${done.session_name}` : done.session_name,
    mode: modeOf(done.session_type),
    top,
    endedAtMs: done.endedAtMs,
  };
}
