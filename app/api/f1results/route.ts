import { liveSocketResults } from "@/lib/live/liveSocket";
import { getSchedule, raceStartISO } from "@/lib/jolpica";
import { liveArchiveResults } from "@/lib/live/liveArchive";
import { getRoundResult, roundStoreConfigured } from "@/lib/store/roundResults";
import { getLatestSessionResult, saveSessionResult, type StoredSessionRow } from "@/lib/store/sessionResults";
import { openF1LatestResult } from "@/lib/openf1/openf1Results";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * Top finishers of the current / most-recently-completed session.
 *
 * Three tiers, cheapest first:
 *
 *  1. The live socket. Tried first whether or not a token is configured — F1's hub serves
 *     DriverList/TimingData to unauthenticated clients, so this is real-time and tokenless.
 *     Answers in milliseconds, and returns null once the socket's window has closed.
 *
 *  2. The durable snapshot. The classification stops changing at the chequered flag, so once
 *     it is stored there is nothing to recompute — this is a single small row.
 *
 * Every tier that yields a FINISHED classification writes it back to the session snapshot (see
 * `capture` below), so the store fills from whichever source happens to answer rather than only
 * from the socket's 5-minute window.
 *
 *  2b. The session snapshot. Same idea as (2) but for ANY session type, and the reason the
 *     ticker no longer goes blank after practice or qualifying: the socket is the only source
 *     that ever holds those, and it shuts 5 minutes after the session ends. Verified during
 *     Italian GP FP1 — the whole meeting was still missing from F1's archive index while the
 *     session was running, so without this tier the ticker fell back to a race from twelve
 *     days earlier and then refused to draw it (24 h TTL), leaving the hero empty.
 *
 *  2c. OpenF1, when 2b has nothing — a session that ended while nobody had the site open was
 *     never captured, and this retains results independently. Free tier is locked out for the
 *     duration of any live F1 session (past sessions included), so it is a genuine fallback
 *     rather than a replacement for 2b; see lib/openf1/openf1Results.ts.
 *
 *  3. The static archive. Correct but EXPENSIVE: it pulls the session's full streams, and
 *     TimingData alone is ~7.5 MB for a race. Measured at 8-9 s on a cold serverless start.
 *     Caching it does not help — at that size it exceeds Vercel's per-entry data-cache limit,
 *     so it is never actually stored and every cold lambda pays the download again. Which is
 *     precisely why tier 2 exists; this is the last resort, for when no snapshot was captured.
 */
// Session names already written by THIS instance, so a poll every 60 s does not become a
// database write every 60 s. Per-lambda on Vercel, which is fine: the upsert is idempotent,
// so the worst case is a handful of redundant writes rather than duplicate rows.
const saved = new Set<string>();

/**
 * Store a finished classification, whichever tier produced it.
 *
 * Every source feeds this, not just the socket. Capturing only from the socket meant the store
 * could only ever be filled during the 5 minutes it stays open after a session — miss that and
 * the session was never recorded at all. The archive keeps its copy indefinitely, so letting it
 * capture too means ANY later visit backfills the row, and the expensive multi-megabyte fetch
 * is paid once rather than on every cold start.
 *
 * Incomplete sessions are never stored: a mid-session order would later be served as though it
 * were the final classification. While a session is live the socket answers directly anyway, so
 * nothing is lost by waiting for the flag.
 */
async function capture(
  r: { session_name: string; mode: "race" | "quali" | "practice"; top: StoredSessionRow[]; endedAtMs?: number },
  complete: boolean,
): Promise<void> {
  if (!complete || !r.top.length || r.endedAtMs == null || saved.has(r.session_name)) return;
  const ok = await saveSessionResult({
    session_name: r.session_name,
    mode: r.mode,
    top: r.top,
    endedAtMs: r.endedAtMs,
  });
  if (ok) saved.add(r.session_name);
}

export async function GET() {
  try {
    const result = await liveSocketResults();
    if (result) {
      // Awaited, not fire-and-forget: a serverless function can be frozen the instant it
      // responds, which would drop a detached write.
      await capture(result, result.complete);
      return Response.json({ status: "ok", ...result });
    }

    // 2b) Whatever finished most recently, of any type. Cheap (one small row) and the only
    //     thing standing between a finished practice session and an empty ticker.
    const stored = await getLatestSessionResult();
    const fromOpenF1 = stored ? null : await openF1LatestResult();
    // Only OpenF1's answer is worth writing back — `stored` came out of that same table.
    if (fromOpenF1) await capture(fromOpenF1, true);
    const lastSession = stored ?? fromOpenF1;
    if (lastSession) {
      return Response.json({
        status: "ok",
        session_name: lastSession.session_name,
        mode: lastSession.mode,
        complete: true,
        live: false,
        endedAtMs: lastSession.endedAtMs,
        top: lastSession.top,
      });
    }

    if (roundStoreConfigured()) {
      // The round comes from the SCHEDULE, not the socket. Asking liveSocketStatus() for it was
      // self-defeating: the socket is shut outside its window, which is precisely when this tier
      // is supposed to answer — so it returned no round, the snapshot was skipped, and every
      // request fell through to the multi-megabyte archive it exists to avoid.
      const now = Date.now();
      const round = (await getSchedule().catch(() => []))
        .filter((r) => Date.parse(raceStartISO(r)) <= now)
        .reduce((max, r) => Math.max(max, Number(r.round) || 0), 0);
      const snap = round > 0 ? await getRoundResult(round) : null;
      if (snap) {
        return Response.json({
          status: "ok",
          session_name: snap.sessionName,
          mode: "race",
          complete: true,
          live: false,
          // Without this the ticker discarded this tier outright: showable() requires an
          // endedAtMs on any complete result, so the snapshot this tier exists to serve was
          // never actually drawn. capturedAt is taken at the flag, so it stands in for the
          // session end to within seconds.
          endedAtMs: snap.capturedAt,
          top: snap.places,
        });
      }
    }

    const free = await liveArchiveResults();
    if (free) await capture(free, free.complete);
    return Response.json(free ? { status: "ok", ...free } : { status: "none" });
  } catch {
    return Response.json({ status: "none" });
  }
}
