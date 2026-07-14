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
 * Horizontal strip: last completed round (dimmed, with its winner), the featured round
 * (black — badged NEXT until its weekend starts, CURRENT once it's underway) and the
 * following four rounds.
 */
export default function Calendar({
  races,
  nextRound,
  winners,
  nowMs,
}: {
  races: Race[];
  nextRound?: string;
  winners?: Record<number, { code: string; name: string }>;
  nowMs?: number;
}) {
  const currentIdx = nextRound ? Math.max(0, races.findIndex((r) => r.round === nextRound)) : 0;
  // Include the round before the current one so its winner stays visible for a week.
  const startIdx = Math.max(0, currentIdx - 1);
  const slice = races.slice(startIdx, startIdx + 6);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {slice.map((race) => {
        const featured = race.round === nextRound;
        // "CURRENT" only once the weekend has actually started (FP1); "NEXT" before that.
        const weekendStartMs = Date.parse(
          `${race.FirstPractice?.date ?? race.date}T${race.FirstPractice?.time ?? "00:00:00Z"}`,
        );
        const underway = featured && nowMs != null && nowMs >= weekendStartMs;
        const current = featured;
        const winner = winners?.[Number(race.round)];
        const past = !current && !!winner;
        return (
          <div
            key={race.round}
            className={[
              "flex flex-col rounded-lg p-4 transition-colors",
              current
                ? "carbon-bg text-white ring-1 ring-white/10"
                : past
                  ? "border border-line bg-panel/60"
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
                  {underway ? "CURRENT" : "NEXT"}
                </span>
              )}
              {past && <span className="text-xs font-bold text-red">✓</span>}
            </div>

            <p
              className={`mt-3 truncate text-sm font-bold ${current ? "text-white" : past ? "text-ink-soft" : "text-ink"}`}
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
            {winner && (
              <p
                className={`mt-1 truncate text-[0.7rem] font-semibold ${current ? "text-white/85" : "text-ink"}`}
                title={`Winner: ${winner.name}`}
              >
                🏆 {winner.code}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
