"use client";

import { useEffect, useState } from "react";
import { Driver, IntervalRow, LapSummary } from "@/lib/timingTypes";
import { formatGap, formatInterval, formatLap, hex } from "@/lib/format";
import { shownStints, type Stint } from "./tyreStints";
import { F1_LIVE } from "@/lib/live/liveConfig";

/** Laps F1's stints may trail the lap count by (it catches up at each line crossing). */
const TYRE_SLACK = 2;
/** Cars on track with incomplete tyre data before the Tracker switches to mini-sectors. */
const TYRE_ERRORS_TO_SWITCH = 2;
/** How long the tyre data must stay complete before switching back. One car's stints keep
 *  dropping behind and catching up, so the count bounced between 1 and 2 and the view flipped
 *  every few seconds (Sepang 2026). */
const SWITCH_BACK_AFTER_MS = 120_000;

/** F1's mini-sector status codes, as F1 TV colours them. Anything else non-zero is "reached". */
const SEGMENT_COLOUR: Record<number, string> = {
  2048: "#f5c518", // yellow — completed
  2049: "#3fa34d", // green — personal best
  2051: "#a855f7", // purple — fastest of anyone
  2064: "#5a5a62", // pit lane
};

type Sector = { segments: number[] };

/** One driver's current lap as F1 TV shows it: a block per mini-sector, grouped by sector. */
function MiniSectors({ sectors }: { sectors?: Sector[] }) {
  return (
    <div className="flex h-5 flex-1 items-center gap-1.5">
      {[0, 1, 2].map((si) => {
        const segs = sectors?.[si]?.segments ?? [];
        return (
          <div key={si} className="flex h-2.5 min-w-0 flex-1 gap-0.5">
            {segs.map((code, k) => (
              <span
                key={k}
                className="h-full min-w-0 flex-1 rounded-[1px]"
                style={{ backgroundColor: code === 0 ? "rgba(255,255,255,0.07)" : (SEGMENT_COLOUR[code] ?? SEGMENT_COLOUR[2048]) }}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

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
  retired,
  stints,
  sectors,
  neutralised = false,
  totalLaps = 0,
  fastestLap,
}: {
  order: number[];
  drivers: Map<number, Driver>;
  positions: Map<number, number>;
  grids?: Map<number, number>;
  intervals: Map<number, IntervalRow>;
  laps: Map<number, LapSummary>;
  retired?: Set<number>;
  stints: Map<number, Stint[]>;
  /** Current-lap mini-sectors per driver — the fallback view when tyre data is incomplete. */
  sectors?: Map<number, Sector[]>;
  /** Not racing — Safety Car, VSC, red flag, formation lap, delayed or suspended start. Mini-
   *  sectors say nothing then (everyone is slow on purpose), so the tyres are shown instead. */
  neutralised?: boolean;
  totalLaps?: number;
  fastestLap?: Fastest | null;
}) {
  const sumOf = (list: Stint[]) => list.reduce((a, s) => a + s.laps, 0);
  // F1's tyre data falls behind the lap count at times (Sepang 2026, after a suspended start:
  // stints adding up to 16 laps for cars on lap 23, HAM's not updated at all). When that is true
  // of 2+ cars still running, show what F1 does report accurately — the current lap's
  // mini-sectors — rather than drawing stints we would have to guess at.
  const tyreErrors = order.filter((n) => {
    if (retired?.has(n)) return false;
    const done = laps.get(n)?.count ?? 0;
    return done - sumOf(stints.get(n) ?? []) > TYRE_SLACK;
  }).length;
  const incomplete = tyreErrors >= TYRE_ERRORS_TO_SWITCH && !!sectors?.size;
  // Switch to mini-sectors at once, back only after the data has stayed complete for a while.
  const [held, setHeld] = useState(false);
  useEffect(() => {
    // Deferred, not set in the effect body — the codebase's rule for setState in effects. A
    // change before the timer fires cancels it, so the switch back needs the full quiet spell.
    const t = setTimeout(() => setHeld(incomplete), incomplete ? 0 : SWITCH_BACK_AFTER_MS);
    return () => clearTimeout(t);
  }, [incomplete]);
  const wanted = F1_LIVE.tyreTracker === "auto" ? (incomplete || held ? "minisectors" : "stints") : F1_LIVE.tyreTracker;
  // Racing again, it returns straight to whatever the tyre data calls for.
  const view = neutralised ? "stints" : wanted;
  const mini = view === "minisectors";

  const shown = new Map(order.map((n) => [n, shownStints(stints.get(n) ?? [])]));
  const maxRun = Math.max(1, ...order.map((n) => sumOf(shown.get(n) ?? [])));
  const scaleMax = Math.max(totalLaps, maxRun, 1);
  const pct = (laps: number) => (laps / scaleMax) * 100;

  const ticks: number[] = [];
  if (totalLaps > 0) for (let t = 0; t <= scaleMax; t += 10) ticks.push(t);

  return (
    <div className="self-start">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
        <span className="eyebrow block text-[0.6rem] text-muted">
          {mini ? (
            <>
              Mini <span className="text-red">Sectors</span>
            </>
          ) : (
            <>
              Tyre <span className="text-red">Tracker</span>
            </>
          )}
        </span>
        {mini && F1_LIVE.tyreTracker === "auto" && (
          <span className="text-[0.6rem] text-muted">
            {`F1's tyre data is incomplete for ${tyreErrors} cars — showing this lap's mini-sectors instead`}
          </span>
        )}
      </div>
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
            {mini ? (
              <div className="flex flex-1 gap-1.5">
                {["S1", "S2", "S3"].map((l) => (
                  <span key={l} className="flex-1 text-center">
                    {l}
                  </span>
                ))}
              </div>
            ) : (
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
            )}
          </div>

          <div className="mt-1 space-y-1">
            {order.map((num, i) => {
              const d = drivers.get(num);
              const pos = positions.get(num) ?? i + 1;
              const isP1 = pos === 1;
              const isFastest = num === fastestLap?.driver_number;
              const isOut = retired?.has(num);
              const list = shown.get(num) ?? [];
              let cum = 0;
              const segs = list.map((st) => {
                const start = cum;
                cum += st.laps;
                return { ...st, start, end: cum };
              });
              return (
                <div key={num} className={`flex items-center gap-2 text-white ${isOut ? "opacity-40" : ""}`}>
                  <span className={`tnum w-6 shrink-0 text-right font-mono text-sm font-bold ${isP1 ? "text-red" : ""}`}>
                    {pos}
                  </span>
                  <Delta grid={grids?.get(num) ?? 0} pos={pos} />
                  <div className="flex w-16 shrink-0 items-center gap-1.5 sm:w-24">
                    <span className="h-4 w-1 shrink-0 rounded-full" style={{ backgroundColor: hex(d?.team_colour) }} />
                    <span className="truncate text-sm font-semibold">{d?.name_acronym ?? num}</span>
                  </div>
                  <span className="tnum hidden w-14 shrink-0 text-right font-mono text-xs font-semibold sm:block">
                    {isOut ? "DNF" : formatGap(intervals.get(num), isP1)}
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
                  {mini ? (
                    <MiniSectors sectors={sectors?.get(num)} />
                  ) : (
                  <div className="relative h-5 flex-1">
                    <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-white/6">
                      {segs.map((s, k) => (
                        <div
                          key={k}
                          className="absolute top-0 h-full"
                          style={{
                            left: `${pct(s.start)}%`,
                            width: `${pct(s.laps)}%`,
                            backgroundColor: color(s.compound),
                          }}
                        />
                      ))}
                    </div>
                    {segs.map((s, k) => (
                      <TyreIcon key={k} compound={s.compound} age={s.age} left={pct(s.end)} />
                    ))}
                  </div>
                  )}
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
