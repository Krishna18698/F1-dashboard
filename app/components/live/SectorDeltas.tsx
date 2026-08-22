"use client";

import { Driver } from "@/lib/openf1";
import { hex } from "@/lib/format";

/**
 * "Where is the lap being lost" — each driver's best S1/S2/S3 against the best anyone has
 * managed in that sector. The timing board's single lap time can't show this: two drivers
 * a tenth apart may be losing it in completely different places.
 *
 * Built from TimingData only (sector times), so it behaves identically with or without an
 * F1 TV token — unlike anything derived from Position.z or CarData.z, which F1 gates.
 */
export default function SectorDeltas({
  order,
  drivers,
  positions,
  bestSectors,
  max = 10,
}: {
  order: number[];
  drivers: Map<number, Driver>;
  positions: Map<number, number>;
  bestSectors: Map<number, (number | null)[]>;
  max?: number;
}) {
  // Session best per sector, across everyone who has set one.
  const sessionBest: (number | null)[] = [0, 1, 2].map((i) => {
    let best: number | null = null;
    for (const secs of bestSectors.values()) {
      const v = secs?.[i];
      if (v != null && (best == null || v < best)) best = v;
    }
    return best;
  });

  const rows = order
    .filter((n) => (bestSectors.get(n) ?? []).some((v) => v != null))
    .sort((a, b) => (positions.get(a) ?? 99) - (positions.get(b) ?? 99))
    .slice(0, max);

  if (!rows.length || sessionBest.every((v) => v == null)) return null;

  // Scale bars against the largest deficit on show, so the chart always uses its full width
  // rather than collapsing when the field is close.
  let worst = 0;
  for (const n of rows) {
    const secs = bestSectors.get(n) ?? [];
    for (let i = 0; i < 3; i++) {
      const b = sessionBest[i];
      const v = secs[i];
      if (b != null && v != null) worst = Math.max(worst, v - b);
    }
  }
  const scale = Math.max(worst, 0.05);

  return (
    <div className="self-start">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="eyebrow block text-[0.6rem] text-muted">
          Where the lap is <span className="text-red">lost</span>
        </span>
        <span className="text-[0.55rem] text-muted">vs best sector</span>
      </div>
      <div className="overflow-hidden rounded-lg border border-line">
        {/* The header uses the SAME nested grid as the rows below — a single merged
            "S1 · S2 · S3" label sat over three separate bars and lined up with none of them. */}
        <div className="grid grid-cols-[2.6rem_1fr] gap-2 border-b border-line bg-panel px-3 py-1.5 text-[0.6rem] font-bold tracking-wider text-muted">
          <span>Driver</span>
          <div className="grid grid-cols-3 gap-1">
            {["S1", "S2", "S3"].map((l) => (
              <span key={l} className="text-center">{l}</span>
            ))}
          </div>
        </div>
        <ol className="divide-y divide-line">
          {rows.map((n) => {
            const d = drivers.get(n);
            const secs = bestSectors.get(n) ?? [];
            return (
              <li key={n} className="grid grid-cols-[2.6rem_1fr] items-center gap-2 px-3 py-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="h-3 w-1 shrink-0 rounded-full" style={{ backgroundColor: hex(d?.team_colour) }} />
                  <span className="truncate text-xs font-semibold">{d?.name_acronym ?? n}</span>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {[0, 1, 2].map((i) => {
                    const b = sessionBest[i];
                    const v = secs[i];
                    const delta = b != null && v != null ? v - b : null;
                    const isBest = delta != null && delta < 0.0005;
                    return (
                      <div key={i}>
                        <div className="h-1 overflow-hidden rounded-sm bg-line">
                          <div
                            className={`h-full rounded-sm ${isBest ? "bg-violet-500" : "bg-red/70"}`}
                            style={{ width: delta == null ? "0%" : `${Math.max(isBest ? 100 : 4, Math.min(100, (delta / scale) * 100))}%` }}
                          />
                        </div>
                        <span className={`tnum block text-center font-timing text-[0.5rem] leading-tight ${isBest ? "text-violet-500" : "text-muted"}`}>
                          {delta == null ? "–" : isBest ? "BEST" : `+${delta.toFixed(3)}`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
