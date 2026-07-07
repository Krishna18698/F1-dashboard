import { getRelayResults } from "@/lib/f1Relay";
import { getStaticResults } from "@/lib/f1feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/** Top finishers of the current / most-recently-completed session. Token relay when
 *  available, otherwise F1's free static feed — so results still show without a token. */
export async function GET() {
  try {
    if (process.env.F1_TV_TOKEN?.trim()) {
      const result = await getRelayResults();
      if (result) return Response.json({ status: "ok", ...result });
    }
    const free = await getStaticResults();
    return Response.json(free ? { status: "ok", ...free } : { status: "none" });
  } catch {
    return Response.json({ status: "none" });
  }
}
