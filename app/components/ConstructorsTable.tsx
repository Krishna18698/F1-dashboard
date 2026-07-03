import { ConstructorStanding } from "@/lib/jolpica";

// Fallback brand colours keyed by constructorId (OpenF1 colours are per-session).
const TEAM_COLOR: Record<string, string> = {
  mercedes: "#00d2be",
  ferrari: "#e10600",
  red_bull: "#3671c6",
  mclaren: "#ff8000",
  aston_martin: "#229971",
  alpine: "#0093cc",
  williams: "#64c4ff",
  rb: "#6692ff",
  sauber: "#52e252",
  haas: "#b6babd",
};

export default function ConstructorsTable({ standings }: { standings: ConstructorStanding[] }) {
  return (
    <ol className="divide-y divide-line">
      {standings.map((s, i) => {
        const color = TEAM_COLOR[s.Constructor.constructorId] ?? "#8a8a92";
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
