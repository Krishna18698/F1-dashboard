import { liveSocketResults, liveSocketStatus } from "@/lib/live/liveSocket";
import { liveArchiveResults } from "@/lib/live/liveArchive";
import { getRoundResult, roundStoreConfigured } from "@/lib/store/roundResults";

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
 *  3. The static archive. Correct but EXPENSIVE: it pulls the session's full streams, and
 *     TimingData alone is ~7.5 MB for a race. Measured at 8-9 s on a cold serverless start.
 *     Caching it does not help — at that size it exceeds Vercel's per-entry data-cache limit,
 *     so it is never actually stored and every cold lambda pays the download again. Which is
 *     precisely why tier 2 exists; this is the last resort, for when no snapshot was captured.
 */
export async function GET() {
  try {
    const result = await liveSocketResults();
    if (result) return Response.json({ status: "ok", ...result });

    if (roundStoreConfigured()) {
      const status = await liveSocketStatus();
      const round = status.round ?? 0;
      const snap = round > 0 ? await getRoundResult(round) : null;
      if (snap) {
        return Response.json({
          status: "ok",
          session_name: snap.sessionName,
          mode: "race",
          complete: true,
          live: false,
          top: snap.places,
        });
      }
    }

    const free = await liveArchiveResults();
    return Response.json(free ? { status: "ok", ...free } : { status: "none" });
  } catch {
    return Response.json({ status: "none" });
  }
}
