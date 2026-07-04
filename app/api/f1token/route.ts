import { getTokenStatus } from "@/lib/f1Token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Returns only expiry status — never the token value. */
export async function GET() {
  return Response.json(getTokenStatus());
}
