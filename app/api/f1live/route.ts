import { NextRequest } from "next/server";
import { fallbackCandidates, getF1LiveState, getReplayAnchorMs, getSessionDuration, resolveLiveSession } from "@/lib/f1feed";
import { getRelayState, getVisitorRelayState } from "@/lib/f1Relay";
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

/** Telemetry shares the position stream's `since`, but its sample timestamps interleave
 *  with (not equal) the position ones — send a 1.5s overlap and let the client's
 *  strictly-increasing buffer drop the duplicates. */
function newTel<T extends { t: number }>(frames: T[], since: number): T[] {
  return newFrames(frames, since ? since - 1500 : 0);
}

/**
 * Serves live map + timing. The client explicitly picks a view via `?view=live|replay`
 * (default live) — this route no longer silently substitutes one for the other.
 *
 * view=live (default):
 *   1) Visitor's own token (X-F1-Token header) → a fresh, isolated connection, torn down
 *      after this one request.
 *   2) Else the site's own F1_TV_TOKEN, if set → real-time SignalR feed.
 *   3) Else F1's free static feed, but ONLY if something is genuinely live right now.
 *   Nothing live → idle (never substitutes a replay here; that's what view=replay is for).
 *
 * view=replay:
 *   Always shows the most recently completed session from lights out, looping, via F1's
 *   free static feed — regardless of tokens or whether something happens to be live.
 */
export async function GET(req: NextRequest) {
  const since = Number(req.nextUrl.searchParams.get("since") ?? 0) || 0;
  const view = req.nextUrl.searchParams.get("view") === "replay" ? "replay" : "live";
  // Client-supplied "when this replay view session started" — anchors the virtual clock so
  // switching into replay always begins at lights out, instead of joining a clock shared
  // across all visitors regardless of when they tuned in. Falls back to now if omitted.
  const replayT0 = Number(req.nextUrl.searchParams.get("t0")) || Date.now();
  // Set when a visitor-supplied token couldn't be used, so whatever the rest of the chain
  // ends up returning (their own live data, the owner's, the free feed, or idle) can still
  // carry a small "your token wasn't used" flag rather than blocking the page entirely.
  let tokenIssue: "invalid" | "busy" | null = null;
  // So the client can tell "nothing's live right now" apart from "no token is configured
  // at all" — the token card should only invite a visitor to add their own in the latter
  // case; the site owner's own env token being merely idle isn't a reason to ask for one.
  const ownerTokenConfigured = Boolean(process.env.F1_TV_TOKEN?.trim());
  const respond = (body: Record<string, unknown>) =>
    Response.json({ ...body, ownerTokenConfigured, ...(tokenIssue ? { tokenIssue } : {}) });

  try {
    // 0) TEST replay — dev-only override, wins regardless of the requested view.
    if (F1_LIVE.replay.enabled) {
      const r = F1_LIVE.replay;
      const dur = await getSessionDuration(r.sessionPath, false);
      const anchor = Math.floor(dur * r.anchorFrac);
      const span = Math.max(1, dur - anchor);
      const upto = anchor + ((Date.now() - r.restartedAtMs) % span);
      const state = await getF1LiveState(r.sessionPath, r.sessionType, upto, false);
      return respond({
        status: "live",
        replay: true,
        circuitKey: r.circuitKey,
        session: { location: r.location, session_name: r.name },
        ...state,
        frames: newFrames(state.frames, since),
        telFrames: newTel(state.telFrames, since),
      });
    }

    if (view === "live") {
      // 1) Visitor's own token — highest priority when supplied. Never logged, never
      //    persisted; exists only for the duration of this one request (see f1Relay.ts).
      const visitorToken = req.headers.get("x-f1-token");
      if (visitorToken) {
        const result = await getVisitorRelayState(visitorToken);
        if (result.status === "ok") {
          return respond({
            status: "live",
            replay: false,
            source: "visitor",
            ...result.state,
            frames: newFrames(result.state.frames, since),
            telFrames: newTel(result.state.telFrames, since),
          });
        }
        // Not usable — flag it, but still fall through to whatever everyone else would see
        // (the owner's token, the free feed, or idle) rather than a dead end.
        if (result.status === "invalid_token") tokenIssue = "invalid";
        else if (result.status === "too_many") tokenIssue = "busy";
        // "no_session" — their token connected fine, just nothing live right now for it —
        // falls through silently, no issue to flag.
      }

      // 2) Real-time via the site's own F1 TV token.
      if (process.env.F1_TV_TOKEN?.trim()) {
        const relay = await getRelayState();
        if (relay && relay.drivers.length > 0) {
          return respond({
            status: "live",
            replay: false,
            source: "token",
            ...relay,
            frames: newFrames(relay.frames, since),
            telFrames: newTel(relay.telFrames, since),
          });
        }
      }

      // 3) Free feed — only a genuinely-live, published session. No fallback replay here;
      //    view=replay is the explicit way to see the most recent session instead.
      const live = await resolveLiveSession();
      if (live && live.startWallMs != null) {
        const upto = Date.now() - live.startWallMs;
        const state = await getF1LiveState(live.path, live.type, upto, true);
        if (state.drivers.length > 0) {
          return respond({
            status: "live",
            replay: false,
            source: "free",
            circuitKey: live.circuitKey,
            session: { location: live.location, session_name: live.name },
            ...state,
            frames: newFrames(state.frames, since),
            telFrames: newTel(state.telFrames, since),
          });
        }
      }

      return respond({ status: "idle" });
    }

    // view === "replay" — always the most recently completed session, from lights out,
    // looping, via the free feed. Deliberate, user-requested view — never idle just
    // because something else happens to be live; that's what view=live is for.
    for (const c of await fallbackCandidates()) {
      const dur = await getSessionDuration(c.path, false);
      if (!dur) continue;
      const anchor = await getReplayAnchorMs(c.path, false);
      const span = Math.max(1, dur - anchor);
      const upto = anchor + ((Date.now() - replayT0) % span);
      const state = await getF1LiveState(c.path, c.type, upto, false);
      if (state.drivers.length > 0) {
        return respond({
          status: "live",
          replay: true,
          source: "free",
          circuitKey: c.circuitKey,
          session: { location: c.location, session_name: c.name },
          ...state,
          frames: newFrames(state.frames, since),
          telFrames: newTel(state.telFrames, since),
        });
      }
    }

    return respond({ status: "idle" });
  } catch {
    return Response.json({ status: "error", ownerTokenConfigured }, { status: 200 });
  }
}
