import { getChampionship } from "@/lib/f1Relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/** Live championship projection. Not token-gated: a token/anonymous A-B against F1's hub
 *  showed ChampionshipPrediction absent for BOTH on a practice session — it's populated by
 *  session type (race/sprint), not by auth — so the relay is asked either way and simply
 *  reports {available:false} when the feed isn't carrying a projection. */
export async function GET() {
  try {
    return Response.json(await getChampionship());
  } catch {
    return Response.json({ available: false });
  }
}
