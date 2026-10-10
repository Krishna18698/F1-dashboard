import type { WeekendSession } from "./jolpica";

/** Largest move from the published schedule an official time may make. Guards against F1's index
 *  still describing a different meeting (its "latest" can be last weekend's before the next
 *  one is published): a real reschedule is hours, never a day. */
const MAX_SHIFT_MS = 12 * 3600_000;

/**
 * The weekend's sessions with F1's own start times where it has them (`starts`, from
 * /api/livestatus: a Race Control announcement, else F1's session index). Jolpica's schedule is
 * fixed once published, so a delayed session kept counting down to its old time — Singapore
 * 2026 qualifying was put back after a delayed Sprint and the hero still said 13:00.
 */
export function withOfficialStarts(sessions: WeekendSession[], starts?: Record<string, number>): WeekendSession[] {
  if (!starts) return sessions;
  return sessions
    .map((s) => {
      const ms = starts[s.label];
      const was = Date.parse(s.iso);
      if (ms == null || !Number.isFinite(was) || Math.abs(ms - was) > MAX_SHIFT_MS || ms === was) return s;
      return { ...s, iso: new Date(ms).toISOString() };
    })
    .sort((a, b) => a.iso.localeCompare(b.iso));
}
