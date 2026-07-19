"use client";

import { Driver } from "@/lib/openf1";
import { hex } from "@/lib/format";

const COLOR: Record<string, string> = { SOFT: "#e10600", MEDIUM: "#f5c518", HARD: "#ffffff" };
const LETTER: Record<string, string> = { SOFT: "S", MEDIUM: "M", HARD: "H" };
const ORDER = ["SOFT", "MEDIUM", "HARD"];
function color(c: string) {
  return COLOR[c] ?? "#5a5a62";
}

type Left = { compound: string; left: number };

/**
 * Qualifying-only: how many fresh sets of each dry compound a driver has LEFT from the
 * weekend's tyre allocation — real usage (the feed's per-stint `New` flag, summed across
 * FP1+FP2+FP3+this session) subtracted from the standard 13-set allocation (8S/3M/2H).
 * The allocation split itself is an assumption (the feed has no topic for the FIA's actual
 * per-round nomination); the usage subtracted from it is real. Distinct from the Tyre
 * Tracker's race-strategy bar, which is about lap distance within one session.
 */
export default function TyreAllocation({
  order,
  drivers,
  positions,
  weekendTyresLeft,
}: {
  order: number[];
  drivers: Map<number, Driver>;
  positions: Map<number, number>;
  weekendTyresLeft: Map<number, Left[]>;
}) {
  const half = Math.ceil(order.length / 2);
  const columns = [order.slice(0, half), order.slice(half)];

  return (
    <div className="self-start">
      <div className="mb-2 flex items-center gap-2">
        <span className="eyebrow block text-[0.6rem] text-muted">
          Tyre <span className="text-red">Allocation</span>
        </span>
        <span
          className="rounded-sm bg-white/10 px-1.5 py-0.5 text-[0.6rem] font-bold tracking-wider text-ink-soft"
          title="New sets left vs. the standard 13-set weekend allocation (8 Soft / 3 Medium / 2 Hard) — real usage from FP1–FP3 + Qualifying, subtracted from the assumed allocation."
        >
          WEEKEND LEFT
        </span>
      </div>
      <div className="carbon-bg overflow-x-auto rounded-lg p-3 ring-1 ring-white/10 sm:p-4">
        <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 lg:grid-cols-2">
          {columns.map((col, colIdx) => (
            <div key={colIdx} className="space-y-1.5">
              {col.map((num) => {
                const d = drivers.get(num);
                const pos = positions.get(num) ?? order.indexOf(num) + 1;
                const byCompound = new Map<string, number>();
                for (const l of weekendTyresLeft.get(num) ?? []) byCompound.set(l.compound, l.left);

                return (
                  <div key={num} className="flex items-center gap-2.5">
                    <span className="tnum w-5 shrink-0 text-right font-mono text-xs text-white/40">{pos}</span>
                    <div className="flex w-16 shrink-0 items-center gap-1.5 sm:w-24">
                      <span className="h-4 w-1 shrink-0 rounded-full" style={{ backgroundColor: hex(d?.team_colour) }} />
                      <span className="truncate text-sm font-semibold text-white">{d?.name_acronym ?? num}</span>
                    </div>
                    <div className="flex flex-1 flex-wrap items-center gap-1.5">
                      {ORDER.map((c) => {
                        const left = byCompound.get(c) ?? 0;
                        const dark = c === "HARD" || c === "MEDIUM";
                        const empty = left === 0;
                        return (
                          <span
                            key={c}
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold ring-1 ${empty ? "opacity-35" : ""}`}
                            style={{ backgroundColor: `${color(c)}22`, borderColor: color(c), color: dark ? "#e5e5e8" : "#fff" }}
                            title={`${c}: ${left} new set${left === 1 ? "" : "s"} left this weekend`}
                          >
                            <span className="h-2 w-2 shrink-0 rounded-full ring-1 ring-black/30" style={{ backgroundColor: color(c) }} />
                            {LETTER[c]} {left}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
