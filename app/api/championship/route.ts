import { getChampionship } from "@/lib/f1Relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/** Live championship projection (needs F1_TV_TOKEN); {available:false} otherwise. */
export async function GET() {
  try {
    if (!process.env.F1_TV_TOKEN?.trim()) return Response.json({ available: false });
    return Response.json(await getChampionship());
  } catch {
    return Response.json({ available: false });
  }
}
