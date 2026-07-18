"use client";

import { Driver } from "@/lib/openf1";
import { hex } from "@/lib/format";

const COLOR: Record<string, string> = {
  SOFT: "#e10600",
  MEDIUM: "#f5c518",
  HARD: "#ffffff",
  INTERMEDIATE: "#3fa34d",
  WET: "#1e6bd6",
  UNKNOWN: "#5a5a62",
};
const LETTER: Record<string, string> = { SOFT: "S", MEDIUM: "M", HARD: "H", INTERMEDIATE: "I", WET: "W" };
// Compound display order — the order teams typically move through in qualifying.
const ORDER = ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"];
function color(c: string) {
  return COLOR[c] ?? COLOR.UNKNOWN;
}

type Stint = { compound: string; laps: number; age: number; isNew: boolean };

/**
 * Qualifying-only: how many tyre sets each driver has used, per compound — split into how
 * many were fresh ("New") vs already-scrubbed sets, from the feed's per-stint `New` flag.
 * Distinct from the Tyre Tracker's race-strategy bar, which is about lap distance, not
 * remaining allocation.
 */
export default function TyreAllocation({
  order,
  drivers,
  positions,
  stints,
}: {
  order: number[];
  drivers: Map<number, Driver>;
  positions: Map<number, number>;
  stints: Map<number, Stint[]>;
}) {
  return (
    <div className="self-start">
      <span className="eyebrow mb-2 block text-[0.6rem] text-muted">
        Tyre <span className="text-red">Allocation</span>
      </span>
      <div className="carbon-bg overflow-x-auto rounded-lg p-3 ring-1 ring-white/10 sm:p-4">
        <div className="space-y-1.5 sm:min-w-md">
          {order.map((num, i) => {
            const d = drivers.get(num);
            const pos = positions.get(num) ?? i + 1;
            const list = stints.get(num) ?? [];

            const byCompound = new Map<string, { count: number; new: number }>();
            for (const st of list) {
              const g = byCompound.get(st.compound) ?? { count: 0, new: 0 };
              g.count += 1;
              if (st.isNew) g.new += 1;
              byCompound.set(st.compound, g);
            }
            const compounds = ORDER.filter((c) => byCompound.has(c));

            return (
              <div key={num} className="flex items-center gap-2.5">
                <span className="tnum w-5 shrink-0 text-right font-mono text-xs text-white/40">{pos}</span>
                <div className="flex w-16 shrink-0 items-center gap-1.5 sm:w-24">
                  <span className="h-4 w-1 shrink-0 rounded-full" style={{ backgroundColor: hex(d?.team_colour) }} />
                  <span className="truncate text-sm font-semibold text-white">{d?.name_acronym ?? num}</span>
                </div>
                <div className="flex flex-1 flex-wrap items-center gap-1.5">
                  {compounds.length === 0 && <span className="text-xs text-white/30">—</span>}
                  {compounds.map((c) => {
                    const g = byCompound.get(c)!;
                    const dark = c === "HARD" || c === "MEDIUM";
                    return (
                      <span
                        key={c}
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold ring-1"
                        style={{ backgroundColor: `${color(c)}22`, borderColor: color(c), color: dark ? "#e5e5e8" : "#fff" }}
                        title={`${c}: ${g.count} set${g.count === 1 ? "" : "s"} used${g.new ? `, ${g.new} new` : ""}`}
                      >
                        <span className="h-2 w-2 shrink-0 rounded-full ring-1 ring-black/30" style={{ backgroundColor: color(c) }} />
                        {LETTER[c]} ×{g.count}
                        {g.new > 0 && <span className="text-white/50">· {g.new} new</span>}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
