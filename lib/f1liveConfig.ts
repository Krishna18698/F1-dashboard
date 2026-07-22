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
  // "auto" = show genuinely-live if it exists, else fall back to the latest completed
  // session (clearly labeled as replay/"LATEST", never claimed as live) — the free static
  // feed isn't real-time for races (confirmed: it published many hours after one actually
  // ended), so pretending to wait for "live" and showing nothing in the meantime isn't
  // honest. Visitors without any token still get to see the last race, just not live.
  mode: "auto" as "auto" | "live" | "replay",
  preferType: "Race",
  pollMs: 3000, // paired with the ~4s car-dot glide for continuous, non-stop motion
  base: "https://livetiming.formula1.com/static",

  /**
   * TEST replay: when enabled, the live panel replays this past session against a
   * real-time virtual clock — so you can verify the map/board/tyres/ticker work
   * before a genuine session. Set enabled:false for normal live behaviour.
   */
  replay: {
    enabled: false,
    sessionPath: "2026/2026-07-05_British_Grand_Prix/2026-07-05_Race/",
    sessionType: "Race",
    circuitKey: 2, // Silverstone
    location: "Silverstone",
    name: "British Grand Prix · Race (test replay)",
    anchorFrac: 0.45,
    // The virtual clock is anchor + ((Date.now() - restartedAtMs) % span) — so playback
    // starts at the anchor point right as of this timestamp, then advances in real time.
    // To "restart" the replay from the anchor WITHOUT restarting the dev server, just bump
    // this to the current time (e.g. `node -e "console.log(Date.now())"`); Next hot-reloads
    // this config module on save, so it takes effect on the next poll.
    restartedAtMs: 1784109249282,
  },
} as const;
