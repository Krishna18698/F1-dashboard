import { Race } from "@/lib/jolpica";

function windowLabel(race: Race): string {
  const start = race.FirstPractice?.date ?? race.date;
  const fmt = (d: string) =>
    new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      timeZone: "UTC",
    });
  return start === race.date ? fmt(race.date) : `${fmt(start)} – ${fmt(race.date)}`;
}

/**
 * Horizontal strip: the current weekend (black) followed by the next five rounds.
 */
export default function Calendar({
  races,
  nextRound,
}: {
  races: Race[];
  nextRound?: string;
}) {
  const startIdx = nextRound ? Math.max(0, races.findIndex((r) => r.round === nextRound)) : 0;
  const slice = races.slice(startIdx, startIdx + 6);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {slice.map((race, i) => {
        const current = i === 0;
        return (
          <div
            key={race.round}
            className={[
              "flex flex-col rounded-lg p-4 transition-colors",
              current
                ? "carbon-bg text-white ring-1 ring-white/10"
                : "border border-line bg-paper hover:border-line-strong",
            ].join(" ")}
          >
            <div className="flex items-center justify-between">
              <span
                className={`tnum font-mono text-xs ${current ? "text-white/60" : "text-muted"}`}
              >
                R{race.round.padStart(2, "0")}
              </span>
              {current && (
                <span className="rounded-sm bg-red px-1.5 py-0.5 text-[0.55rem] font-bold tracking-wide text-white">
                  CURRENT
                </span>
              )}
            </div>

            <p
              className={`mt-3 truncate text-sm font-bold ${current ? "text-white" : "text-ink"}`}
              title={race.raceName}
            >
              {race.Circuit.Location.country}
            </p>
            <p
              className={`truncate text-xs ${current ? "text-white/55" : "text-muted"}`}
            >
              {race.Circuit.Location.locality}
            </p>
            <p
              className={`tnum mt-2 text-[0.7rem] ${current ? "text-white/70" : "text-ink-soft"}`}
            >
              {windowLabel(race)}
            </p>
          </div>
        );
      })}
    </div>
  );
}
