import { ConstructorStanding } from "@/lib/jolpica";
import { teamColor } from "@/lib/teamColors";

export default function ConstructorsTable({ standings }: { standings: ConstructorStanding[] }) {
  return (
    <ol className="divide-y divide-line">
      {standings.map((s, i) => {
        const color = teamColor(s.Constructor.constructorId);
        return (
          <li
            key={s.Constructor.constructorId}
            className="grid grid-cols-[1.6rem_1fr_auto] items-center gap-2 py-2"
          >
            <span
              className={`tnum text-right font-mono text-xs ${
                i === 0 ? "font-bold text-red" : "text-muted"
              }`}
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
