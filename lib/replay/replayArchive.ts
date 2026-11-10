/**
 * REPLAY · source: F1's published static archive (livetiming.formula1.com/static).
 *
 * The deliberate, user-requested view: replay the most recently completed session from lights
 * out, looping. Never chosen automatically — /api/f1live only takes this path for an explicit
 * `?view=replay`, so a replay can never be mistaken for live data.
 *
 * Reads the same archive as lib/live/liveArchive.ts, which asks it the opposite question.
 * Shared parsing stays private in lib/archive/archiveParser.ts.
 */
import { fallbackCandidates, getF1LiveState, getReplayAnchorMs, getReplayTimeline, getSessionDuration, replaySessions } from "../archive/archiveParser";
import type { ResolvedSession } from "../archive/archiveParser";

/** Completed sessions worth replaying, best first. */
export const replayArchiveCandidates = fallbackCandidates;

/** Timing/map state at a point in the replay. */
export const replayArchiveState = getF1LiveState;

/** Where lights-out falls, so a replay starts at the racing rather than the pit-lane wait. */
export const replayArchiveAnchorMs = getReplayAnchorMs;

/** Total length of an archived session, for the replay's virtual clock. */
export const replayArchiveDuration = getSessionDuration;

/** Lights-out, length, lap starts and segment starts — the replay controls' timeline. */
export const replayArchiveTimeline = getReplayTimeline;

/** Every completed session of a season, for the session picker. */
export const replayArchiveSessions = replaySessions;

/**
 * The session a replay request asked for — only if it is one the picker offers for that
 * season. Never a path taken from the URL unchecked: that would let a request make the server
 * fetch whatever it named.
 */
export async function replayArchiveChosen(path: string, year: number): Promise<ResolvedSession | null> {
  if (!Number.isInteger(year) || year < 2018 || year > new Date().getUTCFullYear()) return null;
  const s = (await replaySessions(year)).find((x) => x.path === path);
  return s ? { path: s.path, type: s.type, name: s.name, location: s.location, circuitKey: s.circuitKey, live: false } : null;
}
