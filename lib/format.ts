import { IntervalRow } from "@/lib/openf1";

/** Tyre compound → dot colour + short label. */
export const TYRE: Record<string, { color: string; short: string }> = {
  SOFT: { color: "#e10600", short: "S" },
  MEDIUM: { color: "#f5c518", short: "M" },
  HARD: { color: "#111114", short: "H" },
  INTERMEDIATE: { color: "#3fa34d", short: "I" },
  WET: { color: "#1e6bd6", short: "W" },
  UNKNOWN: { color: "#8a8a92", short: "-" },
};

export function tyre(compound?: string) {
  return TYRE[compound ?? "UNKNOWN"] ?? TYRE.UNKNOWN;
}

/** Ensure a hex colour string has a leading '#'. */
export function hex(c?: string | null) {
  if (!c) return "#8a8a92";
  return c.startsWith("#") ? c : `#${c}`;
}

/** Format the gap-to-leader field, which may be a number of seconds or "+1 LAP". */
export function formatGap(row?: IntervalRow, isLeader?: boolean): string {
  if (isLeader) return "LEADER";
  if (!row || row.gap_to_leader === null || row.gap_to_leader === undefined) return "—";
  const g = row.gap_to_leader;
  if (typeof g === "string") return g; // e.g. "+1 LAP"
  return `+${g.toFixed(3)}`;
}

/** Interval to the car ahead (seconds). */
export function formatInterval(row?: IntervalRow): string {
  if (!row || row.interval === null || row.interval === undefined) return "—";
  const v = row.interval;
  if (typeof v === "string") return v;
  return `+${v.toFixed(3)}`;
}

/** Seconds → lap time, e.g. 89.708 → "1:29.708", 59.512 → "59.512". */
export function formatLap(sec?: number | null): string {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(3);
  return m > 0 ? `${m}:${s.padStart(6, "0")}` : s;
}

/** Delta between a driver's best and the session's fastest, e.g. "+0.234". */
export function formatDelta(best?: number | null, fastest?: number | null): string {
  if (best == null || fastest == null) return "—";
  if (best <= fastest) return "";
  return `+${(best - fastest).toFixed(3)}`;
}

/** 1 → "1st", 2 → "2nd" … */
export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
