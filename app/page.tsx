import {
  getConstructorStandings,
  getDriverStandings,
  getNextRace,
  getSchedule,
} from "@/lib/jolpica";
import { getPaddockIntel } from "@/lib/news";
import Hero from "./components/Hero";
import Section from "./components/Section";
import DriversTable from "./components/DriversTable";
import ConstructorsTable from "./components/ConstructorsTable";
import Calendar from "./components/Calendar";
import PaddockIntel from "./components/PaddockIntel";
import LiveSection from "./components/live/LiveSection";

// Rebuild standings/calendar hourly (they only change after a race weekend).
export const revalidate = 1800;

export default async function Page() {
  const [nextRace, drivers, constructors, schedule, intel] = await Promise.all([
    getNextRace(),
    getDriverStandings().catch(() => []),
    getConstructorStandings().catch(() => []),
    getSchedule().catch(() => []),
    getPaddockIntel().catch(() => []),
  ]);

  return (
    <main className="mx-auto w-full max-w-350 overflow-x-hidden px-4 py-6 sm:px-8 sm:py-8">
      {/* Masthead */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b-4 border-ink pb-3">
        <h1 className="font-display text-2xl leading-none sm:text-4xl lg:text-5xl">
          <span className="text-ink">Krishna Shravan&apos;s </span>
          <span className="text-red">Pit Wall</span>
        </h1>
        <span className="flex items-center gap-2 rounded-sm border border-red px-2 py-1">
          <span className="live-dot h-2 w-2 rounded-full bg-red" />
          <span className="eyebrow text-[0.6rem] text-red">Live Edition</span>
        </span>
      </header>

      <div className="flex flex-col gap-10">
        {/* Current weekend + calendar strip directly beneath it */}
        <div className="flex flex-col gap-4">
          <Hero race={nextRace} />
          {schedule.length > 0 && (
            <Calendar races={schedule} nextRound={nextRace?.round} />
          )}
        </div>

        <LiveSection />

        {/* Wide 3-column row: standings + paddock intel use the side space */}
        <div className="grid gap-10 lg:grid-cols-3">
          <Section title="Drivers'" emphasis="Championship" hint="2026 · latest round">
            {drivers.length ? (
              <DriversTable standings={drivers} />
            ) : (
              <p className="text-sm text-muted">Standings unavailable right now.</p>
            )}
          </Section>

          <Section title="Constructors'" emphasis="Championship" hint="2026 season">
            {constructors.length ? (
              <ConstructorsTable standings={constructors} />
            ) : (
              <p className="text-sm text-muted">Standings unavailable right now.</p>
            )}
          </Section>

          <Section title="Paddock" emphasis="Intel" hint="Latest F1 news">
            <PaddockIntel items={intel} />
          </Section>
        </div>
      </div>

      <footer className="mt-12 border-t border-line pt-5 text-center">
        <p className="font-display text-lg italic">
          For the fans, <span className="text-red">from a fan</span>.
        </p>
      </footer>
    </main>
  );
}
