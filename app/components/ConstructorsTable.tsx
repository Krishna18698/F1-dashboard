"use client";

import { useMemo } from "react";
import { ConstructorStanding, PrevStanding } from "@/lib/jolpica";
import { teamColor } from "@/lib/teamColors";
import { useChampionship } from "./useChampionship";
import Movement from "./Movement";

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
  prev,
}: {
  standings: ConstructorStanding[];
  round: number;
  prev?: Record<string, PrevStanding>;
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
        const p = prev?.[s.Constructor.constructorId];
        const gained = p ? Number(s.points) - p.points : 0;
        return (
          <li
            key={s.Constructor.constructorId}
            className="grid grid-cols-[1.6rem_auto_1fr_auto] items-center gap-2 py-2"
          >
            <span
              className={`tnum text-right font-mono text-xs ${i === 0 ? "font-bold text-red" : "text-muted"}`}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <Movement prevPos={p?.pos} pos={i + 1} />
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-4 w-1 shrink-0 rounded-full" style={{ backgroundColor: color }} />
              <span className="truncate text-sm font-semibold">{s.Constructor.name}</span>
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
