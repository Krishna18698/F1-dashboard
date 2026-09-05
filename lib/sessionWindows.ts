/**
 * Session timing constants shared by every engine that has an opinion about whether something
 * is on track — the live socket, the static feed, the schedule estimate, and the UI.
 *
 * Each value lives here because it answers a question asked in more than one place. When the
 * same question was answered independently in each file, the answers drifted apart and the page
 * contradicted itself: the hero counting down while the board already said LIVE, or one engine
 * calling a session finished while another still called it running.
 */

/**
 * How long BEFORE a session's scheduled start it counts as live.
 *
 * Previously 60 s in the socket and 6 min in both the feed and the schedule guess, so the hero
 * countdown could still be ticking while another part of the page had already flipped to LIVE.
 */
export const PRE_START_LIVE_MS = 2 * 60_000;

/**
 * How long AFTER a session's ESTIMATED end it still counts as live.
 *
 * "Estimated" is the important word. This applies where the end is derived from a schedule —
 * F1's published EndDate, or a start plus an assumed duration — so it has to absorb a session
 * that runs slightly long. It is NOT the same quantity as the socket's post-end grace, which
 * measures from F1's own "Finished" stamp and can therefore be much tighter; see
 * LIVE_GRACE_MS in liveSocket.ts.
 *
 * Was 10 min in the static feed against 5/20 min in the schedule — the same question with two
 * different answers, so for 8 minutes after any session the two engines disagreed about whether
 * it was still running, and which one you saw depended on the order of the fallback chain.
 */
export const POST_END_LIVE_MS = 5 * 60_000;

/**
 * The Grand Prix alone gets a longer one: a red flag, a safety car or a lengthy restart can put
 * a race well past any scheduled end, and it is the one session type where that is routine.
 */
export const POST_END_LIVE_RACE_MS = 20 * 60_000;

/**
 * Post-end window for a session, given F1's `Type` and (optionally) its name.
 *
 * A SPRINT arrives from the feed as Type "Race" with Name "Sprint", so the type alone would
 * hand it the long race window it doesn't need — it runs to a short fixed distance. The name is
 * what separates them.
 */
export function postEndLiveMs(type?: string, name?: string): number {
  const t = (type ?? "").toLowerCase();
  const isSprint = /sprint/i.test(name ?? "") || t.includes("sprint");
  return t === "race" && !isSprint ? POST_END_LIVE_RACE_MS : POST_END_LIVE_MS;
}

/**
 * How long the hero holds a just-finished weekend before moving to the next round, so the
 * results have their moment on screen.
 *
 * Deliberately the SAME two minutes as LIVE_GRACE_MS in liveSocket, which is when live tracking
 * stops. At 5 minutes the two disagreed: for three minutes after every race nothing was live
 * any more, yet the hero still sat on the finished weekend with a dead countdown. One instant
 * now ends the session and moves the page on.
 *
 * Was also written out separately in liveSocket, page.tsx and SessionSchedule — three copies of
 * the same number that nothing kept in agreement.
 */
/**
 * How close to a session boundary the weekend schedule switches to a 1-second clock.
 *
 * Its done-✓ / NEXT markers are pure clock arithmetic, so their accuracy is capped by how often
 * `now` updates. At a flat 30 s they lagged the hero's 1-second chips by up to half a minute at
 * every start and finish. Ticking every second all day would re-render 22 cards 86,400 times to
 * change something twice, so it only speeds up when a boundary is actually near.
 */
export const SCHEDULE_FAST_WINDOW_MS = 5 * 60_000;

/**
 * How long after a qualifying segment's assumed duration expires before that assumption is
 * allowed to declare the segment over.
 *
 * A segment does not end when its clock reaches zero — every car already on a flying lap gets
 * to complete it. F1's own SessionStatus "Finished" marks the real end; this grace only exists
 * so a feed that has gone quiet still eventually resolves. One lap plus an in-lap covers every
 * circuit on the calendar (Monza ~80 s, Spa ~105 s).
 */
export const QUALI_LAST_LAP_GRACE_MS = 2 * 60_000;

export const WEEKEND_FLIP_MS = 2 * 60_000;

/**
 * Segment lengths for qualifying and sprint qualifying, used to drive the "SQ1 ENDED / SQ2 IN
 * m:ss" clock. Duplicated in the socket and the static feed until now; both engines read the
 * same session, so they were never allowed to disagree.
 */
export const QUALI_DURATION_MS: Record<number, number> = {
  1: 18 * 60_000,
  2: 15 * 60_000,
  3: 12 * 60_000,
};

/** Sprint qualifying runs shorter segments — 12/10/8, a 44-minute session end to end. */
export const SPRINT_QUALI_DURATION_MS: Record<number, number> = {
  1: 12 * 60_000,
  2: 10 * 60_000,
  3: 8 * 60_000,
};
