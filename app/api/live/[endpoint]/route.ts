import { NextRequest } from "next/server";

/**
 * Server-side proxy for OpenF1.
 *
 * Why this exists:
 *  1. OpenF1 returns 401 to any request carrying an `Origin` header (i.e. every
 *     browser fetch), so the client cannot call it directly.
 *  2. During a live session OpenF1 restricts all free access and requires an API
 *     key. We attach `OPENF1_API_KEY` here (server-only) if it is configured.
 *
 * The client calls same-origin `/api/live/<endpoint>?<same query>` and we forward.
 */

const OPENF1 = "https://api.openf1.org/v1";
const ALLOWED = new Set([
  "sessions",
  "drivers",
  "position",
  "intervals",
  "stints",
  "location",
  "laps",
]);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ endpoint: string }> },
) {
  const { endpoint } = await params;
  if (!ALLOWED.has(endpoint)) {
    return Response.json({ detail: "Unknown endpoint" }, { status: 404 });
  }

  const url = `${OPENF1}/${endpoint}${req.nextUrl.search}`;
  const headers: Record<string, string> = {};
  const key = process.env.OPENF1_API_KEY;
  if (key) headers["Authorization"] = `Bearer ${key}`;

  try {
    const res = await fetch(url, { headers, cache: "no-store" });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return Response.json({ detail: "Upstream unavailable" }, { status: 502 });
  }
}
