import { NextRequest } from "next/server";
import { fallbackCandidates, getF1LiveState, getSessionDuration, resolveLiveSession } from "@/lib/f1feed";
import { getRelayState } from "@/lib/f1Relay";
import { F1_LIVE } from "@/lib/f1liveConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20; // allow time to connect+subscribe on serverless

/** Incremental frames: only those newer than the client's `since` — shrinks each poll from
 *  the full ~45s window (~100KB to parse on the main thread, which cost an animation frame
 *  every poll) to just the new ~3s of data. */
function newFrames<T extends { t: number }>(frames: T[], since: number): T[] {
  if (!since) return frames;
  let i = frames.length;
  while (i > 0 && frames[i - 1].t > since) i--;
  return frames.slice(i);
}

/**
 * Serves live map + timing.
 * 1) If F1_TV_TOKEN is set → F1's real-time SignalR feed (authenticated, live now).
 * 2) Else → F1's free static feed (only a genuinely-live, published session).
 * Otherwise the client minimizes to "no live session".
 */
export async function GET(req: NextRequest) {
  const since = Number(req.nextUrl.searchParams.get("since") ?? 0) || 0;
  try {
    // 0) TEST replay — advance a past session against a real-time virtual clock.
    if (F1_LIVE.replay.enabled) {
      const r = F1_LIVE.replay;
      const dur = await getSessionDuration(r.sessionPath, false);
      const anchor = Math.floor(dur * r.anchorFrac);
      const span = Math.max(1, dur - anchor);
      const upto = anchor + ((Date.now() - r.restartedAtMs) % span);
      const state = await getF1LiveState(r.sessionPath, r.sessionType, upto, false);
      return Response.json({
        status: "live",
        replay: true,
        circuitKey: r.circuitKey,
        session: { location: r.location, session_name: r.name },
        ...state,
        frames: newFrames(state.frames, since),
      });
    }

    // 1) Real-time via the viewer's F1 TV token. This is AUTHORITATIVE — it knows the
    //    true session status (pre-show / green / ended), so if it says "not live" we
    //    minimize rather than falling back to the time-window static feed.
    if (process.env.F1_TV_TOKEN?.trim()) {
      const relay = await getRelayState();
      if (relay && relay.drivers.length > 0) {
        return Response.json({
          status: "live",
          replay: false,
          source: "token",
          ...relay,
          frames: newFrames(relay.frames, since),
        });
      }
      return Response.json({ status: "idle" });
    }

    const live = await resolveLiveSession();
    if (live && live.startWallMs != null) {
      const upto = Date.now() - live.startWallMs;
      const state = await getF1LiveState(live.path, live.type, upto, true);
      if (state.drivers.length > 0) {
        return Response.json({
          status: "live",
          replay: false,
          source: "free",
          session: { location: live.location, session_name: live.name },
          ...state,
          frames: newFrames(state.frames, since),
        });
      }
    }

    // Fallback candidates (empty in "live" mode) — advance a virtual clock in real time.
    for (const c of await fallbackCandidates()) {
      const dur = await getSessionDuration(c.path, false);
      if (!dur) continue;
      const anchor = Math.floor(dur * F1_LIVE.replayAnchorFrac);
      const span = Math.max(1, dur - anchor);
      const upto = anchor + (Date.now() % span);
      const state = await getF1LiveState(c.path, c.type, upto, false);
      if (state.drivers.length > 0) {
        return Response.json({
          status: "live",
          replay: true,
          source: "free",
          session: { location: c.location, session_name: c.name },
          ...state,
          frames: newFrames(state.frames, since),
        });
      }
    }

    return Response.json({ status: "idle" });
  } catch {
    return Response.json({ status: "error" }, { status: 200 });
  }
}
