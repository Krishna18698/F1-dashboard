import { NextRequest } from "next/server";
import { getRaceControl } from "@/lib/f1Relay";
import { getStaticRaceControl, resolveFreeInstant } from "@/lib/f1feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/** Race control messages for the live session — token relay when available, otherwise
 *  F1's free static feed for the same session/instant `/api/f1live` is showing (`view`/`t0`
 *  must match what the client sent there, or this narrates a different point in the replay). */
export async function GET(req: NextRequest) {
  try {
    if (process.env.F1_TV_TOKEN?.trim()) {
      return Response.json(await getRaceControl());
    }
    const view = req.nextUrl.searchParams.get("view") === "replay" ? "replay" : "live";
    const t0 = Number(req.nextUrl.searchParams.get("t0")) || undefined;
    const instant = await resolveFreeInstant(view, t0);
    if (!instant) return Response.json({ available: false });
    return Response.json(await getStaticRaceControl(instant.path, instant.uptoMs, instant.live));
  } catch {
    return Response.json({ available: false });
  }
}
