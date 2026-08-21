import { getRelayResults } from "@/lib/f1Relay";
import { getStaticResults } from "@/lib/f1feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/** Top finishers of the current / most-recently-completed session.
 *
 *  The relay is tried FIRST whether or not a token is configured: F1's hub serves
 *  DriverList/TimingData to unauthenticated clients, so this works tokenless and is
 *  real-time. The static feed stays as the fallback, but it publishes hours late — with no
 *  token it was leaving the hero's results ticker empty for a whole race weekend. */
export async function GET() {
  try {
    const result = await getRelayResults();
    if (result) return Response.json({ status: "ok", ...result });
    const free = await getStaticResults();
    return Response.json(free ? { status: "ok", ...free } : { status: "none" });
  } catch {
    return Response.json({ status: "none" });
  }
}
