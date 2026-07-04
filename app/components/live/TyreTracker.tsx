"use client";

import { Driver, StintRow } from "@/lib/openf1";

// Tyre compound → line colour (red soft, yellow medium, white hard, …).
const LINE: Record<string, string> = {
  SOFT: "#e10600",
  MEDIUM: "#f5c518",
  HARD: "#ffffff",
  INTERMEDIATE: "#3fa34d",
  WET: "#1e6bd6",
  UNKNOWN: "#5a5a62",
};
function lineColor(c?: string): string {
  return LINE[c ?? "UNKNOWN"] ?? LINE.UNKNOWN;
}

/** Each driver as a straight line coloured by current tyre, in position order. */
export default function TyreTracker({
  order,
  drivers,
  positions,
  stints,
  tyreLaps,
}: {
  order: number[];
  drivers: Map<number, Driver>;
  positions: Map<number, number>;
  stints: Map<number, StintRow>;
  tyreLaps?: Map<number, number>;
}) {
  return (
    <div className="carbon-bg rounded-lg p-3 ring-1 ring-white/10 sm:p-4">
      <span className="eyebrow text-[0.6rem] text-white/45">Tyre Tracker</span>
      {/* Column-major: fills top-to-bottom in column 1, then column 2. */}
      <div className="mt-2 columns-1 gap-x-8 sm:columns-2">
        {order.map((num, i) => {
          const d = drivers.get(num);
          const laps = tyreLaps?.get(num) ?? 0;
          const pos = positions.get(num) ?? i + 1;
          return (
            <div key={num} className="flex items-center gap-2.5 break-inside-avoid py-0.75">
              <span className="tnum w-5 shrink-0 text-right font-mono text-xs text-white/35">{pos}</span>
              <span className="w-10 shrink-0 text-sm font-semibold text-white">{d?.name_acronym ?? num}</span>
              <div
                className="h-1.5 flex-1 rounded-full"
                style={{ backgroundColor: lineColor(stints.get(num)?.compound) }}
              />
              <span className="tnum w-8 shrink-0 text-right font-mono text-xs text-white/50">{laps}L</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
