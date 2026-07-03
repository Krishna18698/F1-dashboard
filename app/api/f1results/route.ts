import { getRelayResults } from "@/lib/f1Relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Top-5 of the current / most-recently-completed session (needs F1_TV_TOKEN). */
export async function GET() {
  try {
    if (!process.env.F1_TV_TOKEN?.trim()) return Response.json({ status: "off" });
    const result = await getRelayResults();
    return Response.json(result ? { status: "ok", ...result } : { status: "none" });
  } catch {
    return Response.json({ status: "none" });
  }
}
