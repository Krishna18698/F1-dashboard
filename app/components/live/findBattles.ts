import type { IntervalRow } from "@/lib/timingTypes";

/** Within this many seconds of the car ahead counts as a battle. */
export const BATTLE_GAP_S = 1;
/** Most battles the panel lists at once. */
export const MAX_BATTLES = 4;

export interface Battle {
  ahead: number;
  behind: number;
  gap: number; // seconds, behind → ahead
}

export type BattlesResult =
  /** `pairs` is the top MAX_BATTLES by position; `total` counts every battle on track. */
  | { state: "ok"; pairs: Battle[]; total: number }
  /** Racing is neutralised — gaps shrink because the field is queued, not fighting. */
  | { state: "neutralised"; reason: "sc" | "vsc" | "red" | "formation" }
  /** Lap 1: the order is still settling and every gap is under a second. */
  | { state: "early" };

/**
 * Seconds from F1's IntervalToPositionAhead. The feed sends TEXT ("+0.903"), not a number, and
 * uses the same field for a lapped car ("1 L", "+1 LAP") — only the plain-seconds form is a gap.
 */
export function intervalSeconds(v: string | number | null | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const m = /^\+?(\d+(?:\.\d+)?)$/.exec((v ?? "").trim());
  return m ? Number(m[1]) : null;
}

/**
 * Pairs of cars racing within a second of each other, from F1's own interval to the car ahead.
 *
 * Only a real on-track fight counts, so a pair is skipped when either car is in the pit lane or
 * out of the race, and when the interval is not plain seconds: F1 sends "1 L" / "+1 LAP" for a
 * lapped car, which is not a gap anyone is closing. Under a safety car, VSC or red flag the whole
 * field bunches up, and on lap 1 everyone is within a second, so those report their state
 * instead of a misleading list.
 */
export function findBattles({
  order,
  positions,
  intervals,
  inPit,
  retired,
  currentLap,
  trackStatus,
  sessionStatus,
  formationLap,
}: {
  order: number[];
  positions: Map<number, number>;
  intervals: Map<number, IntervalRow>;
  inPit?: Set<number>;
  retired?: Set<number>;
  currentLap?: number;
  trackStatus?: string | null;
  sessionStatus?: string | null;
  formationLap?: boolean;
}): BattlesResult {
  if (sessionStatus === "Aborted" || trackStatus === "5") return { state: "neutralised", reason: "red" };
  if (formationLap) return { state: "neutralised", reason: "formation" };
  if (trackStatus === "4") return { state: "neutralised", reason: "sc" };
  if (trackStatus === "6" || trackStatus === "7") return { state: "neutralised", reason: "vsc" };
  if ((currentLap ?? 0) < 2) return { state: "early" };

  const byPos = [...order].sort((a, b) => (positions.get(a) ?? 99) - (positions.get(b) ?? 99));
  const racing = (n: number) => !inPit?.has(n) && !retired?.has(n);
  const pairs: Battle[] = [];
  for (let i = 1; i < byPos.length; i++) {
    const ahead = byPos[i - 1];
    const behind = byPos[i];
    const gap = intervalSeconds(intervals.get(behind)?.interval);
    if (gap == null || gap > BATTLE_GAP_S) continue;
    if (!racing(ahead) || !racing(behind)) continue;
    pairs.push({ ahead, behind, gap });
  }
  return { state: "ok", pairs: pairs.slice(0, MAX_BATTLES), total: pairs.length };
}
