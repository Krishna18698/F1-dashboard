import {
  getConstructorStandings,
  getDriverStandings,
  getNextRace,
  getPrevConstructorStandings,
  getPrevDriverStandings,
  getSchedule,
  getSeasonWinners,
  getStandingsRound,
  hasRaceResult,
  weekendSessions,
} from "@/lib/jolpica";
import { getPaddockIntel } from "@/lib/news";
import { getEndedWeekend } from "@/lib/f1Relay";
import { getLiveStatusData } from "@/lib/liveStatus";
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

// Dynamic: the hero consults the live relay to decide when a finished race weekend should
// flip to the next round. Standings/news stay cached at the fetch layer.
import { applyToConstructors, applyToDrivers, pointsFor } from "@/lib/championshipPoints";
import { getRelayResults } from "@/lib/f1Relay";
import { getStaticResults } from "@/lib/f1feed";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [rawNext, rawDrivers, rawConstructors, schedule, intel, standingsRound, winners, endedWeekend, liveStatus] =
    await Promise.all([
      getNextRace(),
      getDriverStandings().catch(() => []),
      getConstructorStandings().catch(() => []),
      getSchedule().catch(() => []),
      getPaddockIntel().catch(() => []),
      getStandingsRound().catch(() => 0),
      getSeasonWinners().catch(() => ({})),
      // Only the live feed knows when the race is REALLY over (handles red flags / extensions).
      // Works with or without a token now (SessionInfo/SessionStatus are ungated), so the
      // tokenless deploy gets the same accurate weekend flip too. It used to be skipped
      // entirely without a token, so it now costs a relay connection on a cold start where it
      // previously cost nothing — capped tighter than the other relay calls because this only
      // changes anything during the 5 minutes after a race ends, which isn't worth making
      // every other page load wait on. A warm instance reuses the connection and returns
      // instantly; a timeout just means the hero flips on the next render instead.
      Promise.race([
        getEndedWeekend().catch(() => null),
        new Promise<null>((r) => setTimeout(() => r(null), 1200)),
      ]),
      // Seeds the hero/weekend-schedule "live" badge so the first client render already
      // reflects reality instead of flashing the countdown before the first client poll lands.
      getLiveStatusData().catch(() => ({ live: false })),
    ]);

  // Standings after the PREVIOUS round → movement arrows (needs standingsRound, so a 2nd pass;
  // past rounds are immutable and cached a day, so this is usually instant).
  const [prevDrivers, prevConstructors] = await Promise.all([
    getPrevDriverStandings(standingsRound - 1).catch(() => ({})),
    getPrevConstructorStandings(standingsRound - 1).catch(() => ({})),
  ]);


  // The round whose result the page is deciding about, and whether Jolpica has it yet.
  // `standingsRound` cannot answer that: on a SPRINT weekend Jolpica stamps its standings with
  // the round as soon as it ingests the SPRINT, so straight after the Dutch GP it read
  // "round 12" while holding only sprint points — the projection, which did have the race, was
  // discarded as not-ahead and the page showed pre-race totals. Ask about the race directly.
  const weekendRound =
    (liveStatus && "round" in liveStatus ? (liveStatus.round ?? 0) : 0) || endedWeekend?.round || 0;
  const raceIngested = weekendRound > 0 ? await hasRaceResult(weekendRound) : true;
  // What the official standings already account for — the two sources below compare to this.
  const lastScoredRound = raceIngested ? weekendRound : weekendRound - 1;

  // Whichever source has the round FIRST wins. Fastest to slowest:
  //   1. the live projection (ChampionshipPrediction) — applied client-side in the tables,
  //      but token-gated and only served while the relay still holds the session;
  //   2. this: the official totals plus the classification we already have, which needs no
  //      token and keeps working long after the relay has let the session go;
  //   3. Jolpica's official numbers, hours later, which then supersede both.
  // Without step 2 the standings fell back to PRE-RACE totals the moment the relay's grace
  // window closed, and stayed wrong until Jolpica caught up.
  let drivers = rawDrivers;
  let constructors = rawConstructors;
  try {
    const finished = (await getRelayResults()) ?? (await getStaticResults());
    // Only a session that has actually finished, and only one Jolpica is still missing.
    if (finished?.complete && finished.mode === "race" && !raceIngested && finished.top?.length) {
      // `mode` is "race" for a sprint too, so read the name — awarding full race points for a
      // sprint would silently inflate the table by up to 17 points a car.
      const sprint = /sprint/i.test(finished.session_name ?? "");
      const gained = pointsFor(finished.top, sprint);
      const teamOf: Record<string, string> = {};
      // LAST constructor, not the first: Jolpica lists every team a driver has raced for this
      // season in order, so a mid-season switch (2026: LAW is "RB F1 Team THEN Red Bull") makes
      // [0] the team he LEFT. Taking it credited his points to the old team, which showed up as
      // Red Bull 180 / RB 72 against F1's own 186 / 66.
      for (const d of rawDrivers) {
        if (d.Driver.code) teamOf[d.Driver.code] = d.Constructors[d.Constructors.length - 1]?.name ?? "";
      }
      drivers = applyToDrivers(rawDrivers, gained);
      constructors = applyToConstructors(rawConstructors, gained, teamOf);
    }
  } catch {
    // Any failure here just leaves the official numbers in place.
  }
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
        <Hero race={nextRace} initialLiveStatus={liveStatus} nowMs={requestNow()} />

        {/* This weekend's sessions (local time) — above the season calendar */}
        {nextRace && (
          <WeekendSchedule
            sessions={weekendSessions(nextRace)}
            nowMs={requestNow()}
            initialLiveStatus={liveStatus}
          />
        )}

        {schedule.length > 0 && (
          <Section title="Season" emphasis="Calendar" hint="2026 · 22 rounds">
            <Calendar races={schedule} nextRound={nextRace?.round} winners={winners} nowMs={requestNow()} />
          </Section>
        )}

        <LiveSection />

        {/* Wide 3-column row: standings + paddock intel use the side space */}
        <div className="grid gap-10 lg:grid-cols-3">
          <Section title="Drivers'" emphasis="Championship" hint="2026 · latest round">
            {drivers.length ? (
              <DriversTable standings={drivers} resultsRound={lastScoredRound} prev={prevDrivers} />
            ) : (
              <p className="text-sm text-muted">Standings unavailable right now.</p>
            )}
          </Section>

          <Section title="Constructors'" emphasis="Championship" hint="2026 season">
            {constructors.length ? (
              <ConstructorsTable standings={constructors} resultsRound={lastScoredRound} prev={prevConstructors} />
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
