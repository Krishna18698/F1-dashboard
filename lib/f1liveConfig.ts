/**
 * Live engine config — F1's free official timing feed (no API key).
 *
 * mode:
 *   "auto"   → show a genuinely-live session if one exists; otherwise fall back to
 *              the most recent session so the map/board still demonstrate motion.
 *   "live"   → only ever show a genuinely-live session (blank otherwise).
 *   "replay" → always use the most recent session (ignore live detection).
 *
 * preferType: when falling back (nothing live), prefer the latest session of this
 * type so you see that format. "Qualifying" showcases the best-lap board.
 */
export const F1_LIVE = {
  // "live" = only ever show a genuinely-live session; minimize otherwise.
  mode: "live" as "auto" | "live" | "replay",
  preferType: "Qualifying",
  // When replaying a completed session, skip the pre-session build-up and start the
  // virtual clock this far into the session (fraction of its total length).
  replayAnchorFrac: 0.45,
  pollMs: 2500,
  base: "https://livetiming.formula1.com/static",
} as const;
