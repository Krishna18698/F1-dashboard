import { NextRequest } from "next/server";
import { getRaceControl } from "@/lib/f1Relay";
import { getStaticRaceControl, resolveFreeInstant } from "@/lib/f1feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/** Race control messages — the live relay (token or anonymous) for the live view, otherwise
 *  F1's free static feed for the same session/instant `/api/f1live` is showing (`view`/`t0`
 *  must match what the client sent there, or this narrates a different point in the replay). */
export async function GET(req: NextRequest) {
  try {
    const view = req.nextUrl.searchParams.get("view") === "replay" ? "replay" : "live";
    // Live view: the relay carries RaceControlMessages untokenised, so prefer it either way —
    // it's real-time, where the static feed lags by hours. Replay deliberately skips it (the
    // relay only ever knows the CURRENT session; a replay needs the archived one).
    if (view === "live") {
      const relay = await getRaceControl();
      if (relay.available) return Response.json(relay);
    }
    const t0 = Number(req.nextUrl.searchParams.get("t0")) || undefined;
    const asOf = Number(req.nextUrl.searchParams.get("asOf")) || undefined;
    const instant = await resolveFreeInstant(view, t0, asOf);
    if (!instant) return Response.json({ available: false });
    return Response.json(await getStaticRaceControl(instant.path, instant.uptoMs, instant.live));
  } catch {
    return Response.json({ available: false });
  }
}
