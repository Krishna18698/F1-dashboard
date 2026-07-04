import { getLiveStatus } from "@/lib/f1Relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/** Whether a session is on track right now, and which one — for the hero + schedule. */
export async function GET() {
  try {
    if (!process.env.F1_TV_TOKEN?.trim()) return Response.json({ live: false });
    return Response.json(await getLiveStatus());
  } catch {
    return Response.json({ live: false });
  }
}
