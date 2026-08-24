import { liveSocketChampionship } from "@/lib/live/liveSocket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/** Live championship projection.
 *
 *  Almost certainly TOKEN-GATED, on race-day evidence: during the 2026 Dutch GP the tokenless
 *  production deploy reported {available:false} for this exact session while a token-backed
 *  instance returned a full set of projected points. This function has no session-window
 *  guard, so that difference cannot be explained by one of them having dropped the session.
 *
 *  An earlier token/anonymous A-B concluded "not gated", but it ran on a PRACTICE session,
 *  where F1 carries no projection for anyone — so it could not have detected gating either
 *  way. A clean A-B on a race session would settle it for certain.
 *
 *  Either way the socket is asked, and reports {available:false} when nothing comes back —
 *  tokenless deployments fall back to points computed from the finished classification.
 *
 *  TODO(race-weekend): settle it. DURING a race or sprint — the projection only exists then —
 *  hit this route twice against the SAME session, once with F1_TV_TOKEN set and once with it
 *  unset, and compare. Token-only data => gated, confirm the note above. Both populated =>
 *  not gated, and the fallback in page.tsx can be simplified. Next opportunity: Italian GP,
 *  4-6 Sept 2026. */
export async function GET() {
  try {
    return Response.json(await liveSocketChampionship());
  } catch {
    return Response.json({ available: false });
  }
}
