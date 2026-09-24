"use client";

import { Driver } from "@/lib/timingTypes";
import { hex } from "@/lib/format";
import { BATTLE_GAP_S, BattlesResult } from "./findBattles";

const PAUSED: Record<string, string> = {
  sc: "Paused under the Safety Car",
  vsc: "Paused under the Virtual Safety Car",
  red: "Paused — red flag",
  formation: "Starts once the race goes green",
};

/**
 * Race only: who is within a second of the car ahead right now. Trailing car on the left, the
 * car it is chasing on the right, and a bar from each side that meets in the middle — the closer
 * the gap, the longer the bars. Built from TimingData intervals, so it needs no token.
 */
export default function Battles({ result, drivers }: { result: BattlesResult; drivers: Map<number, Driver> }) {
  const tla = (n: number) => drivers.get(n)?.name_acronym ?? String(n);
  const colour = (n: number) => hex(drivers.get(n)?.team_colour);
  const count = result.state === "ok" ? result.pairs.length : 0;

  return (
    <div aria-label="Battles">
      <div className="mb-2 flex items-center gap-2">
        <span className="eyebrow block text-[0.6rem] text-muted">
          On-track <span className="text-red">Battles</span>
        </span>
        {result.state === "ok" && (
          <span className="rounded-sm bg-ink px-1.5 py-0.5 text-[0.6rem] font-bold tracking-wider text-white">
            {count} WITHIN {BATTLE_GAP_S}S
          </span>
        )}
      </div>
      <div className="carbon-bg rounded-lg p-3 ring-1 ring-white/10">
        {result.state === "neutralised" ? (
          <p className="py-2 text-center text-xs text-white/55">{PAUSED[result.reason]}</p>
        ) : result.state === "early" ? (
          <p className="py-2 text-center text-xs text-white/55">From lap 2, once the order settles.</p>
        ) : count === 0 ? (
          <p className="py-2 text-center text-xs text-white/55">No one within a second right now.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            <li className="grid grid-cols-[2.6rem_1fr_3.2rem_1fr_2.6rem] items-center gap-2 text-[0.55rem] font-bold tracking-wider text-white/35">
              <span>CHASING</span>
              <span />
              <span className="text-center">GAP</span>
              <span />
              <span className="text-right">AHEAD</span>
            </li>
            {result.pairs.map((p) => {
              // Closer = longer: a car right on the gearbox fills its half, one a second back barely starts.
              const reach = `${Math.max(6, (1 - p.gap / BATTLE_GAP_S) * 100)}%`;
              return (
                <li
                  key={`${p.behind}-${p.ahead}`}
                  data-behind={p.behind}
                  data-ahead={p.ahead}
                  className="grid grid-cols-[2.6rem_1fr_3.2rem_1fr_2.6rem] items-center gap-2"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-1 shrink-0 rounded-full" style={{ backgroundColor: colour(p.behind) }} />
                    <span className="text-xs font-bold text-white">{tla(p.behind)}</span>
                  </span>
                  <span className="flex h-1.5 justify-end overflow-hidden rounded-full bg-white/10">
                    <span className="h-full rounded-full" style={{ width: reach, backgroundColor: colour(p.behind) }} />
                  </span>
                  <span className="tnum text-center font-timing text-xs font-bold text-white">{p.gap.toFixed(3)}</span>
                  <span className="flex h-1.5 overflow-hidden rounded-full bg-white/10">
                    <span className="h-full rounded-full" style={{ width: reach, backgroundColor: colour(p.ahead) }} />
                  </span>
                  <span className="flex items-center justify-end gap-1.5">
                    <span className="text-xs font-bold text-white">{tla(p.ahead)}</span>
                    <span className="h-3 w-1 shrink-0 rounded-full" style={{ backgroundColor: colour(p.ahead) }} />
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
