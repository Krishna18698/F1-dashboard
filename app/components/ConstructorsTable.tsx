"use client";

import { useMemo } from "react";
import { ConstructorStanding } from "@/lib/jolpica";
import { teamColor } from "@/lib/teamColors";
import { useChampionship } from "./useChampionship";

/** Team names differ between sources ("Red Bull" vs "Red Bull Racing") — fuzzy match. */
function projectedPoints(name: string, points?: Record<string, number>): number | undefined {
  if (!points) return undefined;
  const n = name.toLowerCase();
  const key = Object.keys(points).find((k) => {
    const kl = k.toLowerCase();
    return kl === n || kl.includes(n) || n.includes(kl);
  });
  return key ? points[key] : undefined;
}

export default function ConstructorsTable({
  standings,
  round,
}: {
  standings: ConstructorStanding[];
  round: number;
}) {
  const champ = useChampionship();
  const useProjection = champ.available && (champ.round ?? 0) > round && !!champ.constructorPoints;

  const rows = useMemo(() => {
    if (!useProjection) return standings;
    return standings
      .map((s) => {
        const p = projectedPoints(s.Constructor.name, champ.constructorPoints);
        return p != null ? { ...s, points: String(p) } : s;
      })
      .sort((a, b) => Number(b.points) - Number(a.points));
  }, [standings, useProjection, champ]);

  return (
    <ol className="divide-y divide-line">
      {rows.map((s, i) => {
        const color = teamColor(s.Constructor.constructorId);
        return (
          <li
            key={s.Constructor.constructorId}
            className="grid grid-cols-[1.6rem_1fr_auto] items-center gap-2 py-2"
          >
            <span
              className={`tnum text-right font-mono text-xs ${i === 0 ? "font-bold text-red" : "text-muted"}`}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-4 w-1 shrink-0 rounded-full" style={{ backgroundColor: color }} />
              <span className="truncate text-sm font-semibold">{s.Constructor.name}</span>
            </div>
            <span className="tnum shrink-0 font-mono text-base font-bold">
              {s.points}
              <span className="ml-1 text-[0.55rem] font-normal text-muted">PTS</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
