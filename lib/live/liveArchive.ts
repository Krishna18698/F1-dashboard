/**
 * LIVE · source: F1's published static archive (livetiming.formula1.com/static).
 *
 * The fallback tier of the LIVE path, used when neither a visitor's token nor the site's own
 * one produced a socket answer. It reads the SAME archive the REPLAY mode reads — see
 * lib/replay/replayArchive.ts — but asks a different question of it: "is this session
 * happening right now", rather than "replay the last one that finished".
 *
 * That shared origin is why these two used to live in one file and why it was so easy to lose
 * track of which mode a function belonged to. The parsing stays shared and private in
 * lib/archive/archiveParser.ts; the two modes get their own named front doors.
 *
 * Note the archive publishes HOURS late, so in practice this tier rarely has anything a live
 * viewer wants. The socket — which now works without a token — is what actually carries LIVE.
 */
import { getF1LiveState, getStaticRaceControl, getStaticResults, latestEndedSessionEndMs, resolveFreeInstant, resolveLiveSession } from "../archive/archiveParser";

/** A session the archive says is on track right now, with a published feed path. */
export const liveArchiveSession = resolveLiveSession;

/** Timing/map state for a live session, as of `asOf`. */
export const liveArchiveState = getF1LiveState;

/** Classification of the current or most recently completed session. */
export const liveArchiveResults = getStaticResults;

/** When the most recent already-finished session ended (cheap index read, no streams). */
export const liveArchiveLatestEnd = latestEndedSessionEndMs;

/** Race control messages for the live session. */
export const liveArchiveRaceControl = getStaticRaceControl;

/** Where "now" falls inside a live archived session. */
export const liveArchiveInstant = resolveFreeInstant;
