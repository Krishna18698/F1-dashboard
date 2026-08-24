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
import { fallbackCandidates, getF1LiveState, getReplayAnchorMs, getSessionDuration } from "../archive/archiveParser";

/** Completed sessions worth replaying, best first. */
export const replayArchiveCandidates = fallbackCandidates;

/** Timing/map state at a point in the replay. */
export const replayArchiveState = getF1LiveState;

/** Where lights-out falls, so a replay starts at the racing rather than the pit-lane wait. */
export const replayArchiveAnchorMs = getReplayAnchorMs;

/** Total length of an archived session, for the replay's virtual clock. */
export const replayArchiveDuration = getSessionDuration;
