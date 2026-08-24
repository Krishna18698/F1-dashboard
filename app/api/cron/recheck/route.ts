import { NextRequest } from "next/server";
import { liveSocketResults, liveSocketStatus } from "@/lib/live/liveSocket";
import { liveArchiveResults } from "@/lib/live/liveArchive";
import { getRoundResult, roundStoreConfigured, saveRoundResult } from "@/lib/store/roundResults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Post-race stewards re-check.
 *
 * The classification stored at the chequered flag is provisional — penalties are applied in the
 * hours afterwards and can reorder the finish. This re-reads the result and overwrites the
 * snapshot if it changed.
 *
 * Scheduled daily rather than "N hours after the race": Vercel's Hobby plan runs cron at most
 * once a day, so vercel.json fires this at 01:00 UTC. A Sunday race finishing 14:00-15:00 UTC
 * is then re-checked ~10-11 h later, which is inside the window where penalties have landed but
 * before Jolpica typically publishes. On days with no race it finds nothing and exits.
 *
 * Runs at most once per round: `rechecked_at` is set on the first pass and the round is skipped
 * from then on, so a daily cron cannot keep rewriting a settled result.
 */
export async function GET(req: NextRequest) {
  // Vercel signs cron invocations with CRON_SECRET. Without this the endpoint would let anyone
  // trigger a socket connection and a database write.
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ status: "unauthorized" }, { status: 401 });
  }
  if (!roundStoreConfigured()) return Response.json({ status: "no-store" });

  try {
    const status = await liveSocketStatus();
    const round = status.round ?? 0;
    if (round < 1) return Response.json({ status: "no-round" });

    const stored = await getRoundResult(round);
    if (!stored) return Response.json({ status: "nothing-stored", round });
    if (stored.recheckedAt) return Response.json({ status: "already-rechecked", round });

    // Socket first (it carries any penalty the moment F1 applies it), archive second.
    const fresh = (await liveSocketResults()) ?? (await liveArchiveResults());
    if (!fresh?.complete || !fresh.top?.length) {
      return Response.json({ status: "no-result-available", round });
    }

    const places = fresh.top.map((t) => ({ pos: t.pos, tla: t.tla }));
    const before = stored.places.map((p) => `${p.pos}:${p.tla}`).join(",");
    const after = places.map((p) => `${p.pos}:${p.tla}`).join(",");
    const changed = before !== after;

    await saveRoundResult({
      round,
      sessionName: fresh.session_name ?? stored.sessionName,
      places,
      recheckedAt: Date.now(),
    });

    return Response.json({ status: "ok", round, changed, before: changed ? before : undefined, after: changed ? after : undefined });
  } catch {
    return Response.json({ status: "error" }, { status: 200 });
  }
}
