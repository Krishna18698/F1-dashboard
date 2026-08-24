import { NextRequest } from "next/server";
import { liveSocketRaceControl } from "@/lib/live/liveSocket";
import { liveArchiveInstant, liveArchiveRaceControl } from "@/lib/live/liveArchive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/** Race control messages — the live socket (token or anonymous) for the live view, otherwise
 *  F1's free static feed for the same session/instant `/api/f1live` is showing (`view`/`t0`
 *  must match what the client sent there, or this narrates a different point in the replay). */
export async function GET(req: NextRequest) {
  try {
    const view = req.nextUrl.searchParams.get("view") === "replay" ? "replay" : "live";
    // Live view: the socket carries RaceControlMessages untokenised, so prefer it either way —
    // it's real-time, where the static feed lags by hours. Replay deliberately skips it (the
    // socket only ever knows the CURRENT session; a replay needs the archived one).
    if (view === "live") {
      const socket = await liveSocketRaceControl();
      if (socket.available) return Response.json(socket);
    }
    const t0 = Number(req.nextUrl.searchParams.get("t0")) || undefined;
    const asOf = Number(req.nextUrl.searchParams.get("asOf")) || undefined;
    const instant = await liveArchiveInstant(view, t0, asOf);
    if (!instant) return Response.json({ available: false });
    return Response.json(await liveArchiveRaceControl(instant.path, instant.uptoMs, instant.live));
  } catch {
    return Response.json({ available: false });
  }
}
