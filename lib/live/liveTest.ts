/**
 * LIVE TEST · source: F1's published static archive, played against a virtual clock.
 *
 * A development-only override that makes the LIVE path show a real past session as though it
 * were happening now — the dots move, the board updates, sectors tick over — so live-only
 * behaviour (red flags, formation laps, quali segment clocks) can be worked on without waiting
 * for a race weekend.
 *
 * Distinct from REPLAY in intent, which is why it has its own name: REPLAY is a view a visitor
 * deliberately chooses, whereas this MASQUERADES as live and wins over every other tier. It is
 * gated on `F1_LIVE.replay.enabled`, which must stay `false` in anything committed.
 *
 * `maskTokenGated` additionally withholds exactly what F1 withholds from a tokenless
 * connection — car positions and telemetry — so a token environment can reproduce what a
 * tokenless visitor actually sees.
 */
import { getF1LiveState } from "../archive/archiveParser";

/** Timing/map state at a point in the test replay's virtual clock. */
export const liveTestReplayState = getF1LiveState;

/** Length of the session being test-replayed. */
export { getSessionDuration as liveTestReplayDuration } from "../archive/archiveParser";
