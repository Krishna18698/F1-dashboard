import * as signalR from "@microsoft/signalr";
import WsImpl from "ws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

// Vercel's Node.js serverless runtime has no native `WebSocket` global — @microsoft/signalr
// needs one. lib/f1Relay.ts does the same polyfill for its own (token) connections.
const g = globalThis as unknown as { WebSocket?: unknown };
if (typeof g.WebSocket === "undefined") g.WebSocket = WsImpl;

/**
 * TEMPORARY diagnostic route — proves (from actual Vercel prod infrastructure, not a local
 * sandbox) whether F1's live timing hub returns real timing data over a WebSocket connection
 * that carries no accessTokenFactory / token at all. Delete once confirmed either way.
 */
export async function GET() {
  const HUB = "https://livetiming.formula1.com/signalrcore";
  const conn = new signalR.HubConnectionBuilder()
    .withUrl(HUB, { transport: signalR.HttpTransportType.WebSockets, headers: { "User-Agent": "BestHTTP" } })
    .build();

  try {
    await conn.start();
    const snap = (await conn.invoke("Subscribe", ["DriverList", "TimingData", "SessionInfo"])) as {
      SessionInfo?: { Meeting?: { Name?: string }; Name?: string; ArchiveStatus?: { Status?: string } };
      DriverList?: Record<string, { Tla?: string; TeamName?: string }>;
      TimingData?: { Lines?: Record<string, { Position?: string; BestLapTime?: { Value?: string } }> };
    };
    const drivers = snap.DriverList ?? {};
    const lines = snap.TimingData?.Lines ?? {};
    const rows = Object.entries(lines)
      .map(([num, l]) => ({
        pos: Number(l.Position),
        tla: drivers[num]?.Tla ?? num,
        team: drivers[num]?.TeamName ?? "",
        best: l.BestLapTime?.Value ?? "",
      }))
      .filter((r) => !Number.isNaN(r.pos))
      .sort((a, b) => a.pos - b.pos);

    return Response.json({
      connectedWithoutToken: true,
      session: `${snap.SessionInfo?.Meeting?.Name ?? "?"} - ${snap.SessionInfo?.Name ?? "?"}`,
      archiveStatus: snap.SessionInfo?.ArchiveStatus?.Status ?? null,
      rowCount: rows.length,
      rows,
    });
  } catch (err) {
    return Response.json({ connectedWithoutToken: false, error: String(err) });
  } finally {
    await conn.stop();
  }
}
