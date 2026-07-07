import {
  getConstructorStandings,
  getDriverStandings,
  getNextRace,
  getSchedule,
  getStandingsRound,
  weekendSessions,
} from "@/lib/jolpica";
import { getPaddockIntel } from "@/lib/news";
import { getEndedWeekend } from "@/lib/f1Relay";
import { requestNow } from "@/lib/now";
import Hero from "./components/Hero";
import WeekendSchedule from "./components/WeekendSchedule";
import Section from "./components/Section";
import DriversTable from "./components/DriversTable";
import ConstructorsTable from "./components/ConstructorsTable";
import Calendar from "./components/Calendar";
import PaddockIntel from "./components/PaddockIntel";
import TokenBanner from "./components/TokenBanner";
import LiveSection from "./components/live/LiveSection";
import RaceControl from "./components/live/RaceControl";

// Dynamic: the hero consults the live relay to decide when a finished race weekend should
// flip to the next round. Standings/news stay cached at the fetch layer.
export const dynamic = "force-dynamic";

export default async function Page() {
  const [rawNext, drivers, constructors, schedule, intel, standingsRound, endedWeekend] = await Promise.all([
    getNextRace(),
    getDriverStandings().catch(() => []),
    getConstructorStandings().catch(() => []),
    getSchedule().catch(() => []),
    getPaddockIntel().catch(() => []),
    getStandingsRound().catch(() => 0),
    // Only the live feed knows when the race is REALLY over (handles red flags / extensions).
    // Guarded by token + a short timeout so a page render never hangs on the relay.
    process.env.F1_TV_TOKEN?.trim()
      ? Promise.race([
          getEndedWeekend().catch(() => null),
          new Promise<null>((r) => setTimeout(() => r(null), 2500)),
        ])
      : Promise.resolve(null),
  ]);

  // Flip only once the race is actually NOT live for 5 min (from the feed) — never on a
  // wall-clock guess, so an extended/red-flagged race won't roll over early. Advances the
  // hero, weekend schedule and calendar to the next round together.
  let nextRace = rawNext;
  if (endedWeekend?.flipReady && nextRace && Number(nextRace.round) <= endedWeekend.round) {
    nextRace = schedule.find((r) => Number(r.round) > endedWeekend.round) ?? nextRace;
  }

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

      <TokenBanner />

      <div className="flex flex-col gap-10">
        <Hero race={nextRace} />

        {/* This weekend's sessions (local time) — above the season calendar */}
        {nextRace && <WeekendSchedule sessions={weekendSessions(nextRace)} nowMs={requestNow()} />}

        {schedule.length > 0 && (
          <Section title="Season" emphasis="Calendar" hint="2026 · 22 rounds">
            <Calendar races={schedule} nextRound={nextRace?.round} />
          </Section>
        )}

        <LiveSection />

        {/* Wide 3-column row: standings + paddock intel use the side space */}
        <div className="grid gap-10 lg:grid-cols-3">
          <Section title="Drivers'" emphasis="Championship" hint="2026 · latest round">
            {drivers.length ? (
              <DriversTable standings={drivers} round={standingsRound} />
            ) : (
              <p className="text-sm text-muted">Standings unavailable right now.</p>
            )}
          </Section>

          <Section title="Constructors'" emphasis="Championship" hint="2026 season">
            {constructors.length ? (
              <ConstructorsTable standings={constructors} round={standingsRound} />
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

      {/* Fixed right-side overlay — self-hides unless a session is live */}
      <RaceControl />
    </main>
  );
}
