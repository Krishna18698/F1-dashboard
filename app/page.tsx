import {
  getConstructorStandings,
  getDriverStandings,
  getNextRace,
  getPrevConstructorStandings,
  getPrevDriverStandings,
  getSchedule,
  getSeasonWinners,
  getStandingsRound,
  weekendSessions,
  raceStartISO,
} from "@/lib/jolpica";
import { getPaddockIntel } from "@/lib/news";
import { getLiveStatusData, LiveStatusData } from "@/lib/live/liveStatus";
import { WEEKEND_FLIP_MS } from "@/lib/sessionWindows";
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

// Dynamic: the hero consults the live socket to decide when a finished race weekend should
// flip to the next round. Standings/news stay cached at the fetch layer.
import { applyToConstructors, applyToDrivers, pointsFor } from "@/lib/championshipPoints";
import { getRoundResult, roundStoreConfigured, saveRoundResult } from "@/lib/store/roundResults";
import { liveSocketResults } from "@/lib/live/liveSocket";
import { liveArchiveResults } from "@/lib/live/liveArchive";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [rawNext, rawDrivers, rawConstructors, schedule, intel, standingsRound, winners, liveStatus, finished] =
    await Promise.all([
      getNextRace(),
      getDriverStandings().catch(() => []),
      getConstructorStandings().catch(() => []),
      getSchedule().catch(() => []),
      getPaddockIntel().catch(() => []),
      getStandingsRound().catch(() => 0),
      getSeasonWinners().catch(() => ({})),
      // Seeds the hero/weekend-schedule "live" badge so the first client render already
      // reflects reality instead of flashing the countdown before the first client poll lands.
      getLiveStatusData().catch(() => ({ live: false })),
      // The just-finished classification, for the computed standings below. Depends on
      // nothing, so it belongs in this batch — awaited separately it added a whole extra
      // round trip to every cold start, and its static-feed fallback can pull megabytes.
      (async () => {
        try {
          return (await liveSocketResults()) ?? (await liveArchiveResults());
        } catch {
          return null;
        }
      })(),
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
  // One clock read for the whole render: the standings block and the hero flip below both
  // measure against it, and they must agree.
  const now = requestNow();

  // The last round Jolpica has published a race result for. Derived from `winners` (the P1 of
  // every race it has) rather than a dedicated request — same answer, already in the batch
  // above, and a separate call sat on the critical path of every cold start to learn it.
  const lastScoredRound = Math.max(0, ...Object.keys(winners).map(Number));

  // Whichever source has the round FIRST wins. Fastest to slowest:
  //   1. the live projection (ChampionshipPrediction) — applied client-side in the tables,
  //      but token-gated and only served while the socket still holds the session;
  //   2. this: the official totals plus the classification we already have, which needs no
  //      token and keeps working long after the socket has let the session go;
  //   3. Jolpica's official numbers, hours later, which then supersede both.
  // Without step 2 the standings fell back to PRE-RACE totals the moment the socket's grace
  // window closed, and stayed wrong until Jolpica caught up.
  let drivers = rawDrivers;
  let constructors = rawConstructors;
  {
    // Which round this classification actually belongs to, matched by name. It must NOT come
    // from "the next race": getNextRace() rolls over a few hours after the flag, so by the time
    // these results are being read it already points at the FOLLOWING round. Asking whether
    // that round was ingested always answered "no", and the just-run race got added on top of
    // official totals that already included it — every scorer inflated by their own points.
    const round = schedule.find((r) => (finished?.session_name ?? "").startsWith(r.raceName))?.round;
    const scored = winners as Record<number, { code: string; name: string }>;
    const alreadyIngested = round ? scored[Number(round)] != null : true;

    // The classification, from whichever source still has it.
    //
    // The socket only stays open for a short window after the flag now, so on a page load hours
    // later `finished` is null — the durable snapshot is what keeps the standings right through
    // the gap before Jolpica publishes (~21 h for the 2026 Dutch GP). Looked up by the last race
    // whose start has passed, so it does not depend on the socket being reachable at all.
    const lastRun = [...schedule]
      .filter((r) => Date.parse(raceStartISO(r)) <= now)
      .sort((a, b) => Number(b.round) - Number(a.round))[0];
    const lastRunRound = Number(lastRun?.round ?? 0);
    const lastRunIngested = lastRunRound > 0 && scored[lastRunRound] != null;

    let places: { pos: number; tla: string }[] | null =
      finished?.complete && finished.top?.length ? finished.top : null;
    let sessionName = finished?.session_name ?? "";
    if (!places && !lastRunIngested && lastRunRound > 0 && roundStoreConfigured()) {
      const snap = await getRoundResult(lastRunRound);
      if (snap) {
        places = snap.places;
        sessionName = snap.sessionName;
      }
    }

    // Capture it once, while a source still has it. Guarded on the snapshot being absent so a
    // page render is not a database write; `round_result` is keyed by round, so the flag-time
    // classification is written exactly once and the cron re-check owns it after that.
    if (finished?.complete && finished.top?.length && round && !alreadyIngested && roundStoreConfigured()) {
      const existing = await getRoundResult(Number(round));
      if (!existing) {
        await saveRoundResult({
          round: Number(round),
          sessionName: finished.session_name ?? "",
          places: finished.top.map((x) => ({ pos: x.pos, tla: x.tla })),
        });
      }
    }

    const usingSnapshot = !!places && !finished?.complete;
    const effectiveRound = usingSnapshot ? lastRunRound : Number(round ?? 0);
    const effectiveIngested = usingSnapshot ? lastRunIngested : alreadyIngested;

    // Only a session that has actually finished, and only one Jolpica is still missing.
    if (places && (usingSnapshot || finished?.mode === "race") && !effectiveIngested && effectiveRound > 0) {
      // `mode` is "race" for a sprint too, so read the name — awarding full race points for a
      // sprint would silently inflate the table by up to 17 points a car.
      const sprint = /sprint/i.test(sessionName);
      const gained = pointsFor(places, sprint);
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
  }
  // Flip only once the race is actually NOT live for 5 min (from the feed) — never on a
  // wall-clock guess, so an extended/red-flagged race won't roll over early. Advances the
  // hero, weekend schedule and calendar to the next round together.
  // The hero must ALWAYS be counting down to something — it may never sit on a weekend whose
  // sessions are all in the past with no timer. Two rules, in order of precision:
  //
  //  1. The feed's own end instant. `liveStatus` already carries it (F1's "Finished" stamp,
  //     not this process's idea of when it noticed), so this needs no extra socket connection.
  //     It used to come from liveSocketEndedWeekend() wrapped in a 1200ms Promise.race — a cold
  //     serverless instance cannot open a SignalR connection that fast, so in production it
  //     lost that race on essentially every render and the hero never flipped at all, sitting
  //     on the finished weekend showing "Weekend complete".
  //  2. A pure-schedule guarantee, so the flip happens even with no feed at all: once every
  //     session of the weekend is comfortably past, move on regardless.
  //
  // Both wait out WEEKEND_FLIP_MS first, which is the window where the hero deliberately
  // still shows the just-finished weekend and its results before shifting to the upcoming one.
  let nextRace = rawNext;

  const status = liveStatus as LiveStatusData;
  const endedRound =
    !status.live &&
    (status.type ?? "").toLowerCase() === "race" &&
    !/sprint/i.test(status.name ?? "") &&
    status.endedAt != null &&
    now >= status.endedAt + WEEKEND_FLIP_MS
      ? (status.round ?? 0)
      : 0;
  if (endedRound > 0 && nextRace && Number(nextRace.round) <= endedRound) {
    nextRace = schedule.find((r) => Number(r.round) > endedRound) ?? nextRace;
  }

  // Backstop: whatever the feed says (or doesn't), never leave the hero on a weekend that is
  // entirely over. The last session is the race itself, so allow a generous run time before
  // calling it done, then the same results window.
  const RACE_RUN_MS = 3 * 3600_000;
  if (nextRace) {
    const sessions = weekendSessions(nextRace);
    const lastStart = Date.parse(sessions[sessions.length - 1]?.iso ?? "");
    if (Number.isFinite(lastStart) && now > lastStart + RACE_RUN_MS + WEEKEND_FLIP_MS) {
      nextRace = schedule.find((r) => Number(r.round) > Number(nextRace!.round)) ?? nextRace;
    }
  }

  // Absolute guarantee: the hero is NEVER left without something to count down to. If the
  // selected weekend has no session still ahead of it and nothing is on track, move on — a
  // card reading "Weekend complete" with a dead timer is never an acceptable resting state.
  // Gated on `live` so a race running long (or red-flagged) is never cut short while the feed
  // can still see it; if the feed is unreachable entirely, flipping beats a dead card.
  //
  // Also gated on the end instant being UNKNOWN. When the feed does report one, rule 1 owns
  // the decision and deliberately holds the just-finished weekend for WEEKEND_FLIP_MS so its
  // results get their moment — firing here instead would skip that window entirely.
  const endUnknown = status.endedAt == null;
  if (nextRace && !status.live && endUnknown && weekendSessions(nextRace).every((x) => Date.parse(x.iso) <= now)) {
    nextRace = schedule.find((r) => Number(r.round) > Number(nextRace!.round)) ?? nextRace;
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
