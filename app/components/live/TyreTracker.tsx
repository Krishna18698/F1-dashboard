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
function color(c: string) {
  return COLOR[c] ?? COLOR.UNKNOWN;
}

type Stint = { compound: string; laps: number; age: number };

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

/**
 * Tyre tracker: one horizontal bar per driver across the race's lap axis, split into
 * coloured segments per stint, each ending in the tyre-compound token with the laps
 * run on that tyre (like the F1 broadcast tyre board).
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

  const ticks: number[] = [];
  if (totalLaps > 0) for (let t = 0; t <= scaleMax; t += 10) ticks.push(t);

  return (
    <div className="carbon-bg rounded-lg p-3 ring-1 ring-white/10 sm:p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="eyebrow text-[0.6rem] text-white/45">
          Tyre <span className="text-red">Tracker</span>
        </span>
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
        </div>
      )}

      <div className="space-y-1.5">
        {order.map((num, i) => {
          const d = drivers.get(num);
          const list = stints.get(num) ?? [];
          const pos = positions.get(num) ?? i + 1;
          // Cumulative lap position at the end of each stint (for segment + icon placement).
          let cum = 0;
          const segs = list.map((st) => {
            const start = cum;
            cum += st.laps;
            return { ...st, start, end: cum };
          });
          return (
            <div key={num} className="flex items-center gap-2.5">
              <span className="tnum w-5 shrink-0 text-right font-mono text-xs text-white/35">{pos}</span>
              <span className="w-9 shrink-0 text-sm font-semibold text-white">{d?.name_acronym ?? num}</span>
              <div className="relative h-5 flex-1">
                {/* baseline track + coloured stint segments (clipped) */}
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
                {/* tyre-compound token at the end of each stint */}
                {segs.map((s, k) => (
                  <TyreIcon key={k} compound={s.compound} age={s.age} left={pct(s.end)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
