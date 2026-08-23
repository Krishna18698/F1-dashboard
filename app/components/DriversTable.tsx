"use client";

import { useMemo } from "react";
import { DriverStanding, PrevStanding } from "@/lib/jolpica";
import { teamColor } from "@/lib/teamColors";
import { useChampionship } from "./useChampionship";
import Movement from "./Movement";

export default function DriversTable({
  standings,
  resultsRound,
  prev,
}: {
  standings: DriverStanding[];
  resultsRound: number;
  prev?: Record<string, PrevStanding>;
}) {
  const champ = useChampionship();
  // Use the live projection only while it's AHEAD of Jolpica (instant post-race); once
  // Jolpica ingests the race, fall back to its official numbers.
  //
  // Compared against the last round Jolpica has RACE RESULTS for, not against its standings
  // round. Those differ on a sprint weekend: Jolpica stamps the standings with the round as
  // soon as it ingests the SPRINT, so after the 2026 Dutch GP it reported "round 12" holding
  // only sprint points, this test read 12 > 12 as false, and the projection — which did have
  // the race — was thrown away in favour of pre-race totals.
  const useProjection = champ.available && (champ.round ?? 0) > resultsRound && !!champ.driverPoints;

  const rows = useMemo(() => {
    if (!useProjection) return standings;
    return standings
      .map((s) => ({ ...s, points: String(champ.driverPoints![s.Driver.code ?? ""] ?? s.points) }))
      .sort((a, b) => Number(b.points) - Number(a.points));
  }, [standings, useProjection, champ]);

  return (
    <ol className="divide-y divide-line">
      {rows.map((s, i) => {
        const p = prev?.[s.Driver.driverId];
        const gained = p ? Number(s.points) - p.points : 0;
        return (
          <li
            key={s.Driver.driverId}
            className="grid grid-cols-[1.6rem_auto_1fr_auto] items-center gap-2 py-2"
          >
            <span
              className={`tnum text-right font-mono text-xs ${i === 0 ? "font-bold text-red" : "text-muted"}`}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <Movement prevPos={p?.pos} pos={i + 1} />
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="h-4 w-1 shrink-0 rounded-full"
                style={{ backgroundColor: teamColor(s.Constructors[0]?.constructorId) }}
              />
              <span className="truncate text-sm font-semibold">
                {s.Driver.givenName} {s.Driver.familyName}
              </span>
              {s.Driver.code && (
                <span className="shrink-0 rounded-sm bg-panel-2 px-1 py-0.5 text-[0.55rem] font-bold tracking-wider text-ink-soft">
                  {s.Driver.code}
                </span>
              )}
            </div>
            <span className="tnum shrink-0 text-right font-mono text-base font-bold">
              {s.points}
              <span className="ml-1 text-[0.55rem] font-normal text-muted">PTS</span>
              {gained > 0 && (
                <span className="tnum block text-right font-mono text-[0.6rem] font-normal text-[#37b24d]">
                  +{gained}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
