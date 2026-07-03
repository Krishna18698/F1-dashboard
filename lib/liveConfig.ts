/**
 * Live-tracking behaviour.
 *
 * `replay.enabled = true` lets you SEE the live track map + timing board any time
 * by replaying a real past 2026 session against a virtual clock — the dots actually
 * move and the board updates, exactly as they would during a real session.
 *
 * Flip `replay.enabled = false` for production: the dashboard then auto-detects a
 * genuinely live session (practice / qualifying / race) and shows it in real time,
 * otherwise it shows only "next session in …".
 */
export const LIVE_CONFIG = {
  replay: {
    enabled: true,
    // 2026 Australian GP — Race (verified to have location/position/interval data).
    sessionKey: 11234,
    // Virtual "now" starts here and advances in real time from page load.
    anchorISO: "2026-03-08T04:20:00Z",
    speed: 1,
  },
  // How often to poll OpenF1 while live (ms). Keep >= 2500 to be a good citizen.
  pollMs: 3000,
  year: 2026,
};
