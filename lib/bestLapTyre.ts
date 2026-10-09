/**
 * The compound a driver's best lap was set on, from their stints and the best lap's number.
 *
 * Stints are in order, each covering `laps` of the driver's laps, so counting through them finds
 * the one the lap fell in. Checked against Sepang FP3 2026: for every driver tested this matched
 * the tyre they were on at the moment F1 wrote the best time. Null when there's no best lap yet.
 * Pass the stints UNclamped — trimming them to the lap count would shift the boundaries.
 */
export function compoundOfLap(stints: { compound: string; laps: number }[], lap: number | null | undefined): string | null {
  if (!lap || lap < 1 || !stints.length) return null;
  let done = 0;
  for (const s of stints) {
    if (lap <= done + s.laps) return s.compound;
    done += s.laps;
  }
  // Tyre data runs a beat behind timing, so a lap just completed can sit past the counted stints:
  // it was set on the tyre the car is on now.
  return stints[stints.length - 1].compound;
}

/**
 * A qualifying driver's best from an EARLIER segment, from F1's per-segment `BestLapTimes`.
 * F1 empties `BestLapTime` for everyone still running when a segment ends (Singapore SQ 2026:
 * VER's 1:34.257 gone the moment SQ1 finished, still listed in BestLapTimes[0]), so between
 * segments — and until each driver sets a new time — the board would otherwise be blank.
 */
export function previousSegmentBest(bestLapTimes: unknown): { value: string; lap: number } | null {
  const list = Array.isArray(bestLapTimes)
    ? bestLapTimes
    : bestLapTimes && typeof bestLapTimes === "object"
      ? Object.keys(bestLapTimes as object)
          .sort((a, b) => Number(a) - Number(b))
          .map((k) => (bestLapTimes as Record<string, unknown>)[k])
      : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i] as { Value?: string; Lap?: number } | undefined;
    if (e?.Value) return { value: e.Value, lap: Number(e.Lap ?? 0) };
  }
  return null;
}
