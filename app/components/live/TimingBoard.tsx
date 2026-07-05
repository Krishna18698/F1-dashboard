"use client";

import { Driver, IntervalRow, LapSummary } from "@/lib/openf1";
import { SessionMode } from "./useLiveSession";
import { formatDelta, formatGap, formatInterval, formatLap, hex } from "@/lib/format";

interface Fastest {
  driver_number: number;
  tla: string;
  time: string;
  lap: number;
}

export default function TimingBoard({
  mode,
  order,
  drivers,
  positions,
  grids,
  intervals,
  laps,
  fastestLap,
}: {
  mode: SessionMode;
  order: number[];
  drivers: Map<number, Driver>;
  positions: Map<number, number>;
  grids?: Map<number, number>;
  intervals: Map<number, IntervalRow>;
  laps: Map<number, LapSummary>;
  fastestLap?: Fastest | null;
}) {
  const isRace = mode === "race";
  // Fastest lap in the session (for the quali/practice gap column).
  const fastest = [...laps.values()].reduce<number | null>((m, l) => {
    if (l.best == null) return m;
    return m == null || l.best < m ? l.best : m;
  }, null);

  const cols = isRace
    ? "grid-cols-[2.75rem_1fr_auto_auto]"
    : "grid-cols-[2rem_1fr_auto_auto_auto]";

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
            <>
              <span className="text-right">Gap / Int</span>
              <span className="text-right">Last</span>
            </>
          ) : (
            <>
              <span className="text-right">Best</span>
              <span className="text-right">Gap</span>
              <span className="pl-2 text-center">Lap</span>
            </>
          )}
        </div>

        <ol className="divide-y divide-line">
          {order.map((num, i) => {
            const d = drivers.get(num);
            const pos = isRace ? (positions.get(num) ?? i + 1) : i + 1;
            const isP1 = pos === 1;
            const lap = laps.get(num);
            return (
              <li key={num} className={`grid ${cols} items-center gap-2 px-3 py-2`}>
                <div className="flex items-center justify-end gap-1">
                  <span className={`tnum font-mono text-sm font-bold ${isP1 ? "text-red" : ""}`}>{pos}</span>
                  {isRace && <Delta grid={grids?.get(num) ?? 0} pos={pos} />}
                </div>

                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-4 w-1 shrink-0 rounded-full" style={{ backgroundColor: hex(d?.team_colour) }} />
                  <span className="truncate text-sm font-semibold">{d?.name_acronym ?? num}</span>
                  <span className="hidden truncate text-xs text-muted sm:inline">{d?.team_name}</span>
                </div>

                {isRace ? (
                  <>
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
                    <span
                      className={`tnum text-right font-mono text-xs ${
                        num === fastestLap?.driver_number ? "font-bold text-[#b800e0]" : "text-white/80"
                      }`}
                    >
                      {formatLap(lap?.last) || "—"}
                    </span>
                  </>
                ) : (
                  <>
                    <span className={`tnum text-right font-mono text-xs font-bold ${isP1 ? "text-red" : ""}`}>
                      {formatLap(lap?.best)}
                    </span>
                    <span className="tnum text-right font-mono text-[0.7rem] text-muted">
                      {isP1 ? "—" : formatDelta(lap?.best, fastest) || "—"}
                    </span>
                    <span className="tnum text-center font-mono text-[0.7rem] text-muted">{lap?.count ?? 0}</span>
                  </>
                )}
              </li>
            );
          })}
        </ol>

        {fastestLap && fastestLap.time && (
          <div className="flex items-center gap-2 border-t border-line bg-panel px-3 py-2 text-[0.65rem]">
            <span className="rounded-sm bg-[#b800e0] px-1.5 py-0.5 font-bold tracking-wider text-white">FASTEST LAP</span>
            <span className="font-semibold">{fastestLap.tla}</span>
            <span className="tnum font-mono">{fastestLap.time}</span>
            {fastestLap.lap > 0 && <span className="text-muted">· Lap {fastestLap.lap}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/** Positions gained (green ▲) / lost (red ▼) vs the starting grid. */
function Delta({ grid, pos }: { grid: number; pos: number }) {
  if (!grid) return <span className="w-3.5 shrink-0" />; // unknown grid — keep column width stable
  const d = grid - pos;
  if (d === 0) return <span className="w-3.5 shrink-0 text-center text-[0.6rem] text-muted">–</span>;
  const up = d > 0;
  return (
    <span
      className="tnum flex shrink-0 items-center font-mono text-[0.6rem] font-bold leading-none"
      style={{ color: up ? "#37b24d" : "#e10600" }}
      title={`${up ? "+" : "−"}${Math.abs(d)} vs grid P${grid}`}
    >
      {up ? "▲" : "▼"}
      {Math.abs(d)}
    </span>
  );
}
