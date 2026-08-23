/**
 * How long before a session's scheduled start it counts as "live".
 *
 * This lived as three different numbers — 60s in the relay, 6 min in the static feed, 6 min
 * in the schedule guess — so the hero countdown could still be ticking while another part of
 * the page had already flipped to LIVE. One constant, imported everywhere, keeps them in step.
 */
export const PRE_START_LIVE_MS = 2 * 60_000;
