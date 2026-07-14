"use client";

import { Driver, IntervalRow, LapSummary } from "@/lib/openf1";
import { SessionMode } from "./useLiveSession";
import { formatDelta, formatGap, formatInterval, formatLap, hex } from "@/lib/format";

/**
 * Driver Live Tracker — a clean running order: position, driver, gap to leader + interval
 * (race) or best lap + gap (quali/practice). The richer strategy view lives in the Tyre Tracker.
 */
export default function TimingBoard({
  mode,
  order,
  drivers,
  positions,
  intervals,
  laps,
  selectedNum,
  onSelect,
}: {
  mode: SessionMode;
  order: number[];
  drivers: Map<number, Driver>;
  positions: Map<number, number>;
  intervals: Map<number, IntervalRow>;
  laps: Map<number, LapSummary>;
  selectedNum?: number | null;
  onSelect?: (num: number | null) => void;
}) {
  const isRace = mode === "race";
  const fastest = [...laps.values()].reduce<number | null>((m, l) => {
    if (l.best == null) return m;
    return m == null || l.best < m ? l.best : m;
  }, null);

  const cols = isRace ? "grid-cols-[2rem_1fr_auto]" : "grid-cols-[2rem_1fr_auto_auto]";

  return (
    <div className="self-start">
      <span className="eyebrow mb-2 block text-[0.6rem] text-muted">
        Driver Live <span className="text-red">Tracker</span>
      </span>
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
            const lap = laps.get(num);
            return (
              <li
                key={num}
                onClick={() => onSelect?.(isSel ? null : num)}
                className={`grid ${cols} cursor-pointer items-center gap-2 px-2 py-1.5 transition-colors sm:px-3 sm:py-2 ${
                  isSel ? "bg-red/5 ring-1 ring-inset ring-red/30" : "hover:bg-panel"
                }`}
              >
                <span className={`tnum text-right font-mono text-sm font-bold ${isP1 ? "text-red" : ""}`}>{pos}</span>

                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-4 w-1 shrink-0 rounded-full" style={{ backgroundColor: hex(d?.team_colour) }} />
                  <span className="truncate text-sm font-semibold">{d?.name_acronym ?? num}</span>
                  <span className="hidden truncate text-xs text-muted sm:inline">{d?.team_name}</span>
                </div>

                {isRace ? (
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
