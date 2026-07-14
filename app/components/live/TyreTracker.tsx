"use client";

import { Driver, IntervalRow, LapSummary } from "@/lib/openf1";
import { formatGap, formatInterval, formatLap, hex } from "@/lib/format";

// Tyre compound → colour (F1 sidewall colours).
const COLOR: Record<string, string> = {
  SOFT: "#e10600",
  MEDIUM: "#f5c518",
  HARD: "#ffffff",
  INTERMEDIATE: "#3fa34d",
  WET: "#1e6bd6",
  UNKNOWN: "#5a5a62",
};
function color(c: string) {
  return COLOR[c] ?? COLOR.UNKNOWN;
}

type Stint = { compound: string; laps: number; age: number };
interface Fastest {
  driver_number: number;
  tla: string;
  time: string;
  lap: number;
}

/** The F1 tyre-compound token: a coloured ring with the laps-on-tyre count inside. */
function TyreIcon({ compound, age, left }: { compound: string; age: number; left: number }) {
  return (
    <div
      className="absolute top-1/2 flex h-4.75 w-4.75 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 bg-[#15151a]"
      style={{ borderColor: color(compound), left: `${Math.min(98.5, left)}%` }}
      title={`${compound} · ${age} lap${age === 1 ? "" : "s"}`}
    >
      <span className="tnum text-[0.5rem] font-bold leading-none text-white">{age}</span>
    </div>
  );
}

/** Positions gained (green ▲) / lost (red ▼) vs the starting grid. */
function Delta({ grid, pos }: { grid: number; pos: number }) {
  if (!grid) return <span className="w-7 shrink-0" />;
  const d = grid - pos;
  if (d === 0) return <span className="w-7 shrink-0 text-center text-[0.6rem] text-white/30">–</span>;
  const up = d > 0;
  return (
    <span
      className="tnum flex w-7 shrink-0 items-center justify-center gap-0.5 font-mono text-[0.6rem] font-bold leading-none"
      style={{ color: up ? "#37b24d" : "#e10600" }}
      title={`${up ? "+" : "−"}${Math.abs(d)} vs grid P${grid}`}
    >
      {up ? "▲" : "▼"}
      {Math.abs(d)}
    </span>
  );
}

/**
 * The live board (F1-broadcast style): position + gained/lost, driver, gap, interval,
 * last lap, and a per-driver tyre-stint bar across the race lap axis, with a fastest-lap
 * footer. One combined view — no separate standings table.
 */
export default function TyreTracker({
  order,
  drivers,
  positions,
  grids,
  intervals,
  laps,
  stints,
  totalLaps = 0,
  fastestLap,
}: {
  order: number[];
  drivers: Map<number, Driver>;
  positions: Map<number, number>;
  grids?: Map<number, number>;
  intervals: Map<number, IntervalRow>;
  laps: Map<number, LapSummary>;
  stints: Map<number, Stint[]>;
  totalLaps?: number;
  fastestLap?: Fastest | null;
}) {
  const sumOf = (list: Stint[]) => list.reduce((a, s) => a + s.laps, 0);
  const maxRun = Math.max(1, ...order.map((n) => sumOf(stints.get(n) ?? [])));
  const scaleMax = Math.max(totalLaps, maxRun, 1);
  const pct = (laps: number) => (laps / scaleMax) * 100;

  const ticks: number[] = [];
  if (totalLaps > 0) for (let t = 0; t <= scaleMax; t += 10) ticks.push(t);

  return (
    <div className="self-start">
      <span className="eyebrow mb-2 block text-[0.6rem] text-muted">
        Tyre <span className="text-red">Tracker</span>
      </span>
      <div className="carbon-bg overflow-x-auto rounded-lg p-3 ring-1 ring-white/10 sm:p-4">
        {/* On phones the timing columns hide (the stint bar is the point) so it fits with no scroll. */}
        <div className="sm:min-w-xl">
          {/* Column header + lap axis */}
          <div className="flex items-center gap-2 border-b border-white/10 pb-1.5 text-[0.55rem] font-bold uppercase tracking-wider text-white/35">
            <span className="w-6 shrink-0 text-right">P</span>
            <span className="w-7 shrink-0" />
            <span className="w-16 shrink-0 sm:w-24">Driver</span>
            <span className="hidden w-14 shrink-0 text-right sm:block">Gap</span>
            <span className="hidden w-12 shrink-0 text-right sm:block">Int</span>
            <span className="hidden w-14 shrink-0 text-right sm:block">Last</span>
            <div className="relative h-3 flex-1">
              {ticks.map((t) => (
                <span
                  key={t}
                  className="tnum absolute -translate-x-1/2 font-mono text-[0.5rem] normal-case text-white/30"
                  style={{ left: `${Math.min(100, pct(t))}%` }}
                >
                  {t}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-1 space-y-1">
            {order.map((num, i) => {
              const d = drivers.get(num);
              const pos = positions.get(num) ?? i + 1;
              const isP1 = pos === 1;
              const isFastest = num === fastestLap?.driver_number;
              const list = stints.get(num) ?? [];
              let cum = 0;
              const segs = list.map((st) => {
                const start = cum;
                cum += st.laps;
                return { ...st, start, end: cum };
              });
              return (
                <div key={num} className="flex items-center gap-2 text-white">
                  <span className={`tnum w-6 shrink-0 text-right font-mono text-sm font-bold ${isP1 ? "text-red" : ""}`}>
                    {pos}
                  </span>
                  <Delta grid={grids?.get(num) ?? 0} pos={pos} />
                  <div className="flex w-16 shrink-0 items-center gap-1.5 sm:w-24">
                    <span className="h-4 w-1 shrink-0 rounded-full" style={{ backgroundColor: hex(d?.team_colour) }} />
                    <span className="truncate text-sm font-semibold">{d?.name_acronym ?? num}</span>
                  </div>
                  <span className="tnum hidden w-14 shrink-0 text-right font-mono text-xs font-semibold sm:block">
                    {formatGap(intervals.get(num), isP1)}
                  </span>
                  <span className="tnum hidden w-12 shrink-0 text-right font-mono text-[0.7rem] text-white/45 sm:block">
                    {isP1 ? "" : formatInterval(intervals.get(num))}
                  </span>
                  <span
                    className={`tnum hidden w-14 shrink-0 text-right font-mono text-xs sm:block ${
                      isFastest ? "font-bold text-[#d84bff]" : "text-white/80"
                    }`}
                  >
                    {formatLap(laps.get(num)?.last) || "—"}
                  </span>
                  <div className="relative h-5 flex-1">
                    <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-white/6">
                      {segs.map((s, k) => (
                        <div
                          key={k}
                          className="absolute top-0 h-full"
                          style={{ left: `${pct(s.start)}%`, width: `${pct(s.laps)}%`, backgroundColor: color(s.compound) }}
                        />
                      ))}
                    </div>
                    {segs.map((s, k) => (
                      <TyreIcon key={k} compound={s.compound} age={s.age} left={pct(s.end)} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {fastestLap && fastestLap.time && (
            <div className="mt-2 flex items-center gap-2 border-t border-white/10 pt-2 text-[0.65rem]">
              <span className="rounded-sm bg-[#b800e0] px-1.5 py-0.5 font-bold uppercase tracking-wider text-white">
                Fastest Lap
              </span>
              <span className="font-semibold text-white">{fastestLap.tla}</span>
              <span className="tnum font-mono text-white/90">{fastestLap.time}</span>
              {fastestLap.lap > 0 && <span className="text-white/40">· Lap {fastestLap.lap}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
