import { Race, weekendSessions } from "@/lib/jolpica";
import { lapRecord } from "@/lib/lapRecords";
import SessionSchedule from "./SessionSchedule";
import SessionResults from "./SessionResults";

function formatWindow(race: Race): string {
  const start = race.FirstPractice?.date ?? race.date;
  const end = race.date;
  const fmt = (d: string) =>
    new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  return start === end ? fmt(end) : `${fmt(start)} – ${fmt(end)}`;
}

export default function Hero({ race }: { race: Race | null }) {
  if (!race) {
    return (
      <section className="carbon-bg rounded-xl p-8 text-white">
        <p className="eyebrow text-xs text-white/50">Season complete</p>
        <h2 className="font-display mt-2 text-3xl italic">See you next season.</h2>
      </section>
    );
  }

  const flag = race.Circuit.Location.country;
  const record = lapRecord(race.Circuit.circuitId);

  return (
    <section className="carbon-bg overflow-hidden rounded-xl text-white ring-1 ring-white/10">
      <div className="flex flex-col gap-8 p-6 sm:p-8 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <span className="rounded-sm bg-red px-2 py-0.5 text-[0.65rem] font-bold tracking-wider text-white">
              ROUND {race.round}
            </span>
            <span className="eyebrow text-xs text-white/45">Up Next · {flag}</span>
          </div>

          <h2 className="font-display mt-4 text-4xl leading-[0.95] sm:text-5xl lg:text-6xl">
            {race.raceName.replace(" Grand Prix", "")}{" "}
            <span className="italic text-red">Grand Prix</span>
          </h2>

          <p className="mt-3 text-sm text-white/60">
            {race.Circuit.circuitName} · {race.Circuit.Location.locality}
          </p>
          <p className="mt-1 text-sm text-white/45">{formatWindow(race)} · 2026</p>

          {record && (
            <div className="mt-5 inline-flex items-center gap-3 rounded-md bg-white/5 px-3 py-2 ring-1 ring-white/10">
              <span className="eyebrow text-[0.55rem] text-white/45">Lap Record</span>
              <span className="tnum font-mono text-lg font-bold text-white">
                {record.time}
              </span>
              <span className="text-xs text-white/55">
                {record.driver} · {record.year}
              </span>
            </div>
          )}
        </div>

        <div className="lg:text-right">
          <SessionSchedule sessions={weekendSessions(race)} />
        </div>
      </div>

      <SessionResults />
    </section>
  );
}
