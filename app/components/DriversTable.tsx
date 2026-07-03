import { DriverStanding } from "@/lib/jolpica";

export default function DriversTable({ standings }: { standings: DriverStanding[] }) {
  return (
    <ol className="divide-y divide-line">
      {standings.map((s, i) => (
        <li
          key={s.Driver.driverId}
          className="grid grid-cols-[1.6rem_1fr_auto] items-center gap-2 py-2"
        >
          <span
            className={`tnum text-right font-mono text-xs ${
              i === 0 ? "font-bold text-red" : "text-muted"
            }`}
          >
            {String(i + 1).padStart(2, "0")}
          </span>

          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-semibold">
              {s.Driver.givenName} {s.Driver.familyName}
            </span>
            {s.Driver.code && (
              <span className="shrink-0 rounded-sm bg-panel-2 px-1 py-0.5 text-[0.55rem] font-bold tracking-wider text-ink-soft">
                {s.Driver.code}
              </span>
            )}
          </div>

          <span className="tnum shrink-0 font-mono text-base font-bold">
            {s.points}
            <span className="ml-1 text-[0.55rem] font-normal text-muted">PTS</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
