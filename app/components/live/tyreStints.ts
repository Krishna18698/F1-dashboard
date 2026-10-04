export type Stint = { compound: string; laps: number; age: number };

/**
 * F1's stints as the Tyre Tracker draws them: F1's own list, minus noise — nothing is added or
 * moved. Seen at Sepang 2026, after a rain delay, a suspended start and a Safety Car restart,
 * every set fitted on the grid or in the pit lane before lights out was logged as a stint of 0
 * or 1 laps (VER: Inter 1, Inter 0, Inter 1), piling 2–4 tokens at lap 0.
 *
 *  - Zero-lap sets never ran a lap and are dropped (a fresh one at the END is a real new set).
 *  - The leading run of ≤1-lap sets merges into the last of them — the tyre the car started on —
 *    keeping their lap count.
 *
 * Where F1's stints then fall short of the laps run, they are drawn as F1 sent them: the Tracker
 * reports the data as incomplete rather than guessing where the missing laps belong.
 */
export function shownStints(list: Stint[]): Stint[] {
  if (!list.length) return list;
  let out = list.filter((s, i) => s.laps > 0 || i === list.length - 1).map((s) => ({ ...s }));
  let run = 0;
  while (run < out.length && out[run].laps <= 1) run++;
  if (run >= 2) {
    const laps = out.slice(0, run).reduce((a, s) => a + s.laps, 0);
    out = [{ ...out[run - 1], laps, age: laps }, ...out.slice(run)];
  }
  return out;
}
