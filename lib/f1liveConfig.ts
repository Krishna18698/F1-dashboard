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
  pollMs: 3000, // paired with the ~4s car-dot glide for continuous, non-stop motion
  base: "https://livetiming.formula1.com/static",

  /**
   * TEST replay: when enabled, the live panel replays this past session against a
   * real-time virtual clock — so you can verify the map/board/tyres/ticker work
   * before a genuine session. Set enabled:false for normal live behaviour.
   */
  replay: {
    enabled: false,
    sessionPath: "2026/2026-06-28_Austrian_Grand_Prix/2026-06-28_Race/",
    sessionType: "Race",
    circuitKey: 19, // Red Bull Ring (Spielberg)
    location: "Spielberg",
    name: "Austrian Grand Prix · Race (test replay)",
    anchorFrac: 0.45,
  },
} as const;
