import { getRaceControl } from "@/lib/f1Relay";
import { getStaticRaceControl, resolveFreeInstant } from "@/lib/f1feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/** Race control messages for the live session — token relay when available, otherwise
 *  F1's free static feed for the same session `/api/f1live` is showing. */
export async function GET() {
  try {
    if (process.env.F1_TV_TOKEN?.trim()) {
      return Response.json(await getRaceControl());
    }
    const instant = await resolveFreeInstant();
    if (!instant) return Response.json({ available: false });
    return Response.json(await getStaticRaceControl(instant.path, instant.uptoMs, instant.live));
  } catch {
    return Response.json({ available: false });
  }
}
