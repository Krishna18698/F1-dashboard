"use client";

import { Driver, IntervalRow, LapSummary } from "@/lib/openf1";
import { SessionMode } from "./useLiveSession";
import { formatDelta, formatGap, formatInterval, formatLap, hex } from "@/lib/format";

// FIA quali format: Q1 cuts the field to 15, Q2 cuts to 10 — fixed regardless of grid size.
const QUALI_CUTOFF: Record<number, number> = { 1: 15, 2: 10 };

/** Bottom N of the still-active (not yet eliminated) field, in current ranked order. */
function dangerZone(order: number[], knockedOut: Set<number> | undefined, part: number | null | undefined): Set<number> {
  const cutoff = part ? QUALI_CUTOFF[part] : undefined;
  if (!cutoff) return new Set();
  const active = order.filter((n) => !knockedOut?.has(n));
  return active.length > cutoff ? new Set(active.slice(cutoff)) : new Set();
}

/**
 * Driver Live Tracker — a clean running order: position, driver, gap to leader + interval
 * (race) or best lap + gap (quali/practice). The richer strategy view lives in the Tyre Tracker.
 * In qualifying, shows which segment is live (Q1/Q2/Q3) and shades the elimination zone red.
 */
export default function TimingBoard({
  mode,
  order,
  drivers,
  positions,
  intervals,
  laps,
  retired,
  qualifyingPart,
  knockedOut,
  selectedNum,
  onSelect,
}: {
  mode: SessionMode;
  order: number[];
  drivers: Map<number, Driver>;
  positions: Map<number, number>;
  intervals: Map<number, IntervalRow>;
  laps: Map<number, LapSummary>;
  retired?: Set<number>;
  qualifyingPart?: number | null;
  knockedOut?: Set<number>;
  selectedNum?: number | null;
  onSelect?: (num: number | null) => void;
}) {
  const isRace = mode === "race";
  const isQuali = mode === "quali";
  const fastest = [...laps.values()].reduce<number | null>((m, l) => {
    if (l.best == null) return m;
    return m == null || l.best < m ? l.best : m;
  }, null);

  const danger = isQuali ? dangerZone(order, knockedOut, qualifyingPart) : new Set<number>();

  const cols = isRace ? "grid-cols-[2rem_1fr_auto]" : "grid-cols-[2rem_1fr_auto_auto]";

  return (
    <div className="self-start">
      <div className="mb-2 flex items-center gap-2">
        <span className="eyebrow block text-[0.6rem] text-muted">
          Driver Live <span className="text-red">Tracker</span>
        </span>
        {isQuali && qualifyingPart && (
          <span className="rounded-sm bg-ink px-1.5 py-0.5 text-[0.6rem] font-bold tracking-wider text-white">
            Q{qualifyingPart}
          </span>
        )}
      </div>
      <div className="overflow-hidden rounded-lg border border-line">
        <div
          className={`grid ${cols} gap-2 border-b border-line bg-panel px-3 py-2 text-[0.6rem] font-bold tracking-wider text-muted`}
        >
          <span className="text-right">P</span>
          <span>Driver</span>
          {isRace ? (
            <span className="text-right">Gap / Int</span>
          ) : (
            <>
              <span className="text-right">Best</span>
              <span className="text-right">Gap</span>
            </>
          )}
        </div>

        <ol className="divide-y divide-line">
          {order.map((num, i) => {
            const d = drivers.get(num);
            const pos = isRace ? (positions.get(num) ?? i + 1) : i + 1;
            const isP1 = pos === 1;
            const isSel = num === selectedNum;
            const isOut = retired?.has(num);
            const inDanger = danger.has(num);
            const lap = laps.get(num);
            return (
              <li
                key={num}
                onClick={() => onSelect?.(isSel ? null : num)}
                className={`grid ${cols} cursor-pointer items-center gap-2 px-2 py-1.5 transition-colors sm:px-3 sm:py-2 ${
                  isSel
                    ? "bg-red/5 ring-1 ring-inset ring-red/30"
                    : inDanger
                      ? "bg-red/10 hover:bg-red/15"
                      : "hover:bg-panel"
                } ${isOut ? "opacity-50" : ""}`}
                title={inDanger ? "Provisionally eliminated if the session ended now" : undefined}
              >
                <span className={`tnum text-right font-mono text-sm font-bold ${isP1 ? "text-red" : ""}`}>{pos}</span>

                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-4 w-1 shrink-0 rounded-full" style={{ backgroundColor: hex(d?.team_colour) }} />
                  <span className={`truncate text-sm font-semibold ${inDanger ? "text-red" : ""}`}>
                    {d?.name_acronym ?? num}
                  </span>
                  <span className="hidden truncate text-xs text-muted sm:inline">{d?.team_name}</span>
                </div>

                {isRace ? (
                  isOut ? (
                    <div className="text-right">
                      <span className="rounded-sm bg-ink px-1.5 py-0.5 text-[0.6rem] font-bold tracking-wider text-white">
                        DNF
                      </span>
                    </div>
                  ) : (
                    <div className="text-right">
                      <span className="tnum block font-mono text-xs font-semibold">
                        {formatGap(intervals.get(num), isP1)}
                      </span>
                      {!isP1 && (
                        <span className="tnum block font-mono text-[0.6rem] text-muted">
                          {formatInterval(intervals.get(num))}
                        </span>
                      )}
                    </div>
                  )
                ) : (
                  <>
                    <span className={`tnum text-right font-mono text-xs font-bold ${isP1 ? "text-red" : ""}`}>
                      {formatLap(lap?.best)}
                    </span>
                    <span className="tnum text-right font-mono text-[0.7rem] text-muted">
                      {isP1 ? "—" : formatDelta(lap?.best, fastest) || "—"}
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
