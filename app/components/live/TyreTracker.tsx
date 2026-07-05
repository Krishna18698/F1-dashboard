"use client";

import { Driver } from "@/lib/openf1";

// Tyre compound → colour (F1 sidewall colours).
const COLOR: Record<string, string> = {
  SOFT: "#e10600",
  MEDIUM: "#f5c518",
  HARD: "#ffffff",
  INTERMEDIATE: "#3fa34d",
  WET: "#1e6bd6",
  UNKNOWN: "#5a5a62",
};
// Compounds with a light fill need dark text on the segment.
const DARK_TEXT = new Set(["HARD", "MEDIUM"]);
const LETTER: Record<string, string> = { SOFT: "S", MEDIUM: "M", HARD: "H", INTERMEDIATE: "I", WET: "W" };

function color(c: string) {
  return COLOR[c] ?? COLOR.UNKNOWN;
}

type Stint = { compound: string; laps: number };

/**
 * Tyre-strategy board: one horizontal bar per driver across the race's lap axis,
 * split into coloured segments per stint (like the F1 broadcast tyre board).
 */
export default function TyreTracker({
  order,
  drivers,
  positions,
  stints,
  totalLaps = 0,
}: {
  order: number[];
  drivers: Map<number, Driver>;
  positions: Map<number, number>;
  stints: Map<number, Stint[]>;
  totalLaps?: number;
}) {
  const sumOf = (list: Stint[]) => list.reduce((a, s) => a + s.laps, 0);
  // Axis = race distance if known, else the field's longest run (quali/practice).
  const maxRun = Math.max(1, ...order.map((n) => sumOf(stints.get(n) ?? [])));
  const scaleMax = Math.max(totalLaps, maxRun, 1);
  const pct = (laps: number) => (laps / scaleMax) * 100;

  // Axis ticks every 10 laps (only meaningful once we have a real lap axis).
  const ticks: number[] = [];
  if (totalLaps > 0) for (let t = 0; t <= scaleMax; t += 10) ticks.push(t);

  return (
    <div className="carbon-bg rounded-lg p-3 ring-1 ring-white/10 sm:p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="eyebrow text-[0.6rem] text-white/45">Tyre Strategy</span>
        {totalLaps > 0 && <span className="tnum font-mono text-[0.6rem] text-white/35">{scaleMax} laps</span>}
      </div>

      {/* Lap-axis header (aligned with the bar column) */}
      {ticks.length > 0 && (
        <div className="mb-1 flex items-center gap-2.5">
          <span className="w-5 shrink-0" />
          <span className="w-9 shrink-0" />
          <div className="relative h-3 flex-1">
            {ticks.map((t) => (
              <span
                key={t}
                className="tnum absolute -translate-x-1/2 font-mono text-[0.5rem] text-white/30"
                style={{ left: `${Math.min(100, pct(t))}%` }}
              >
                {t}
              </span>
            ))}
          </div>
          <span className="w-7 shrink-0" />
        </div>
      )}

      <div className="space-y-1">
        {order.map((num, i) => {
          const d = drivers.get(num);
          const list = stints.get(num) ?? [];
          const pos = positions.get(num) ?? i + 1;
          const done = sumOf(list);
          return (
            <div key={num} className="flex items-center gap-2.5">
              <span className="tnum w-5 shrink-0 text-right font-mono text-xs text-white/35">{pos}</span>
              <span className="w-9 shrink-0 text-sm font-semibold text-white">{d?.name_acronym ?? num}</span>
              <div className="relative h-3.5 flex-1 overflow-hidden rounded-sm bg-white/6">
                <div className="flex h-full">
                  {list.map((st, k) => {
                    const w = pct(st.laps);
                    return (
                      <div
                        key={k}
                        className="flex h-full shrink-0 items-center justify-center border-r border-black/30 last:border-r-0"
                        style={{ width: `${w}%`, backgroundColor: color(st.compound) }}
                        title={`${st.compound} · ${st.laps} lap${st.laps === 1 ? "" : "s"}`}
                      >
                        {w > 6 && LETTER[st.compound] && (
                          <span
                            className="text-[0.5rem] font-extrabold leading-none"
                            style={{ color: DARK_TEXT.has(st.compound) ? "#15151a" : "#fff" }}
                          >
                            {LETTER[st.compound]}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
                {/* Current-position marker at the leading edge of the filled part. */}
                {done > 0 && done < scaleMax && (
                  <div className="absolute top-0 h-full w-px bg-white/80" style={{ left: `${pct(done)}%` }} />
                )}
              </div>
              <span className="tnum w-7 shrink-0 text-right font-mono text-xs text-white/50">
                {list.length ? `${list[list.length - 1].laps}L` : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
