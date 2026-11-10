import { NextRequest } from "next/server";
import { liveSocketRaceControl } from "@/lib/live/liveSocket";
import { liveArchiveInstant, liveArchiveRaceControl } from "@/lib/live/liveArchive";
import { replayArchiveChosen } from "@/lib/replay/replayArchive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

// What's due this far past the map's instant is sent too, for the page to reveal on time: a
// little more than the 5 s between its polls.
const AHEAD_MS = 8_000;

/** Race control messages — the live socket (token or anonymous) for the live view, otherwise
 *  F1's free static feed for the same session/instant `/api/f1live` is showing (`view`/`t0`
 *  must match what the client sent there, or this narrates a different point in the replay). */
export async function GET(req: NextRequest) {
  try {
    const view = req.nextUrl.searchParams.get("view") === "replay" ? "replay" : "live";
    // The instant the map is drawing — every view narrates that moment, not the feed's newest.
    const asOf = Number(req.nextUrl.searchParams.get("asOf")) || undefined;
    // Live view: the socket carries RaceControlMessages untokenised, so prefer it either way —
    // it's real-time, where the static feed lags by hours. Replay deliberately skips it (the
    // socket only ever knows the CURRENT session; a replay needs the archived one).
    if (view === "live") {
      const socket = await liveSocketRaceControl(asOf, AHEAD_MS);
      if (socket.available) return Response.json(socket);
    }
    // A replay driven by its controls names its session and where it is: narrate exactly that.
    const sessionParam = req.nextUrl.searchParams.get("session");
    if (view === "replay" && sessionParam) {
      const chosen = await replayArchiveChosen(sessionParam, Number(req.nextUrl.searchParams.get("year")));
      const at = asOf ?? (Number(req.nextUrl.searchParams.get("pos")) || undefined);
      if (!chosen || !at) return Response.json({ available: false });
      return Response.json(await liveArchiveRaceControl(chosen.path, at, false, AHEAD_MS));
    }
    const t0 = Number(req.nextUrl.searchParams.get("t0")) || undefined;
    const instant = await liveArchiveInstant(view, t0, asOf);
    if (!instant) return Response.json({ available: false });
    return Response.json(await liveArchiveRaceControl(instant.path, instant.uptoMs, instant.live, asOf ? AHEAD_MS : 0));
  } catch {
    return Response.json({ available: false });
  }
}
