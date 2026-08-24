import { getLiveStatusData } from "@/lib/live/liveStatus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/** Whether a session is on track right now, and which one — for the hero + schedule. */
export async function GET() {
  return Response.json(await getLiveStatusData());
}
