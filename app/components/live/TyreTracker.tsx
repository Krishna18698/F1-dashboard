"use client";

import { Driver, StintRow } from "@/lib/openf1";
import { hex, tyre } from "@/lib/format";

/** Per-driver current tyre + laps on it, ordered by position — mirrors the grid. */
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
    <div className="overflow-hidden rounded-lg border border-line">
      <div className="border-b border-line bg-panel px-3 py-2">
        <span className="eyebrow text-[0.6rem] font-bold text-muted">Tyre Tracker</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 p-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {order.map((num, i) => {
          const d = drivers.get(num);
          const t = tyre(stints.get(num)?.compound);
          const laps = tyreLaps?.get(num) ?? 0;
          const pos = positions.get(num) ?? i + 1;
          return (
            <div
              key={num}
              className="flex items-center gap-2 rounded-md bg-panel/60 px-2 py-1.5"
            >
              <span className="tnum w-4 shrink-0 text-right font-mono text-xs text-muted">
                {pos}
              </span>
              <span
                className="h-4 w-1 shrink-0 rounded-full"
                style={{ backgroundColor: hex(d?.team_colour) }}
              />
              <span className="flex-1 truncate text-sm font-semibold">
                {d?.name_acronym ?? num}
              </span>
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.55rem] font-bold ring-1 ring-black/10"
                style={{ backgroundColor: t.color, color: t.short === "M" ? "#111" : "#fff" }}
                title={stints.get(num)?.compound ?? "Unknown"}
              >
                {t.short}
              </span>
              <span className="tnum w-7 shrink-0 text-right font-mono text-xs text-ink-soft">
                {laps}L
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
