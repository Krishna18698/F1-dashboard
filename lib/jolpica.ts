/**
 * Jolpica-F1 (Ergast successor) — free, no key. Covers the 2026 season.
 * Used server-side for standings, calendar and next-race data.
 * Docs: https://github.com/jolpica/jolpica-f1
 */

import { postEndLiveMs, PRE_START_LIVE_MS } from "./sessionWindows";
const BASE = "https://api.jolpi.ca/ergast/f1";
export const SEASON = "2026";

// Revalidate every 10 min so we reflect Jolpica's updates soon after it processes a
// session (its own lag aside). Standings change only a few times per weekend.
const REVALIDATE = 600;

async function get<T>(path: string, revalidate: number = REVALIDATE): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    next: { revalidate },
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Jolpica ${path} → ${res.status}`);
  return (await res.json()) as T;
}

/* ----------------------------- Shared types ----------------------------- */
export interface Circuit {
  circuitId: string;
  circuitName: string;
  Location: { locality: string; country: string; lat: string; long: string };
}
interface SessionTime {
  date: string;
  time?: string;
}
export interface Race {
  season: string;
  round: string;
  raceName: string;
  Circuit: Circuit;
  date: string;
  time?: string;
  FirstPractice?: SessionTime;
  SecondPractice?: SessionTime;
  ThirdPractice?: SessionTime;
  SprintQualifying?: SessionTime;
  Sprint?: SessionTime;
  Qualifying?: SessionTime;
}

export interface WeekendSession {
  label: string;
  short: string;
  iso: string;
}

/** All sessions of a race weekend, in chronological order (pure — no clock read). */
export function weekendSessions(race: Race): WeekendSession[] {
  const out: WeekendSession[] = [];
  const add = (s: SessionTime | undefined, label: string, short: string) => {
    if (s?.date) out.push({ label, short, iso: `${s.date}T${s.time ?? "12:00:00Z"}` });
  };
  add(race.FirstPractice, "Practice 1", "FP1");
  add(race.SecondPractice, "Practice 2", "FP2");
  add(race.ThirdPractice, "Practice 3", "FP3");
  add(race.SprintQualifying, "Sprint Qualifying", "SQ");
  add(race.Sprint, "Sprint", "Sprint");
  add(race.Qualifying, "Qualifying", "Quali");
  out.push({ label: "Race", short: "Race", iso: raceStartISO(race) });
  return out.sort((a, b) => a.iso.localeCompare(b.iso));
}

// Best-effort scheduled duration per session type — used only to guess "is this session
// probably still running" when no token/live feed is available to check the real thing.
// Race was originally the FIA's absolute red-flag-extended cap (3h) rather than a typical
// race length (~1h30-2h from lights out) — with no token configured (e.g. on a fresh
// deploy), that left the site showing "still live" for over an hour after a normal-length
// race had actually finished, since this schedule-only guess has no way to see the
// chequered flag. 2h plus the grace buffer below comfortably covers a normal race without
// that long a tail; a red-flag-extended race is the rare case this trades away.
const SESSION_DURATION_MS: Record<string, number> = {
  FP1: 60 * 60_000,
  FP2: 60 * 60_000,
  FP3: 60 * 60_000,
  // Sprint Qualifying is SQ1+SQ2+SQ3 (12/10/8) plus the breaks — 44 min end to end per F1's
  // own SessionInfo (16:30–17:14 at Zandvoort), not the 60 a full qualifying runs.
  SQ: 45 * 60_000,
  Sprint: 45 * 60_000,
  Quali: 60 * 60_000,
  Race: 2 * 3600_000,
};
// How long after a session's assumed end to still call it "live" — covers the schedule
// guess above running a little short. 20 min was a user-requested buffer specifically for
// RACES (which can genuinely run long under a red flag/safety car) — applying that same 20
// min uniformly to a 60-minute practice session left it reporting "happening right now" for
// up to 20 minutes after a practice session had already finished on schedule, which practice/
// quali/sprint sessions reliably do (no red-flag-length tail to cover). Race keeps the longer

/**
 * Which session of this weekend (if any) is happening right now, going purely by schedule
 * time — independent of F1's own live-timing Index.json, which can lag a session actually
 * starting by hours or not list a meeting at all yet. Not pure (reads the clock).
 */
export function currentlyLiveWeekendSession(race: Race): WeekendSession | null {
  const now = Date.now();
  for (const s of weekendSessions(race)) {
    const start = Date.parse(s.iso);
    const duration = SESSION_DURATION_MS[s.short] ?? 60 * 60_000;
    const grace = postEndLiveMs(s.short, s.label);
    if (now >= start - PRE_START_LIVE_MS && now <= start + duration + grace) return s;
  }
  return null;
}
/**
 * Is any session of this weekend near enough that F1's live feed is worth a socket?
 *
 * The socket holds a WebSocket to livetiming.formula1.com, and opening one costs a negotiate +
 * handshake + Subscribe + snapshot — seconds on a cold serverless instance. Outside a race
 * weekend it can only ever report "nothing is live", which the schedule already knows for
 * free. So the schedule decides whether the socket is worth opening at all.
 *
 * Deliberately generous in BOTH directions, because the risks are not symmetric: too WIDE
 * merely opens a socket that reports nothing, while too NARROW makes a live session look dead.
 * Callers should also fail OPEN when the schedule itself is unavailable.
 */
export function withinFeedWindow(race: Race, beforeMs: number, afterMs: number, now = Date.now()): boolean {
  return weekendSessions(race).some((s) => {
    const start = Date.parse(s.iso);
    if (!Number.isFinite(start)) return false;
    const duration = SESSION_DURATION_MS[s.short] ?? 60 * 60_000;
    return now >= start - beforeMs && now <= start + duration + afterMs;
  });
}

export interface DriverStanding {
  position: string;
  points: string;
  wins: string;
  Driver: {
    driverId: string;
    permanentNumber?: string;
    code?: string;
    givenName: string;
    familyName: string;
    nationality: string;
  };
  Constructors: { constructorId: string; name: string }[];
}
export interface ConstructorStanding {
  position: string;
  points: string;
  wins: string;
  Constructor: { constructorId: string; name: string; nationality: string };
}

/* ----------------------------- Fetchers ----------------------------- */
export async function getDriverStandings(): Promise<DriverStanding[]> {
  const d = await get<{
    MRData: { StandingsTable: { StandingsLists: { DriverStandings: DriverStanding[] }[] } };
  }>(`/${SEASON}/driverstandings/`);
  return d.MRData.StandingsTable.StandingsLists[0]?.DriverStandings ?? [];
}

export async function getConstructorStandings(): Promise<ConstructorStanding[]> {
  const d = await get<{
    MRData: {
      StandingsTable: { StandingsLists: { ConstructorStandings: ConstructorStanding[] }[] };
    };
  }>(`/${SEASON}/constructorstandings/`);
  return d.MRData.StandingsTable.StandingsLists[0]?.ConstructorStandings ?? [];
}

/** Position + points after a specific PAST round — for movement arrows. Cached a day (immutable). */
export interface PrevStanding {
  pos: number;
  points: number;
}
export async function getPrevDriverStandings(round: number): Promise<Record<string, PrevStanding>> {
  if (round < 1) return {};
  const d = await get<{
    MRData: { StandingsTable: { StandingsLists: { DriverStandings: DriverStanding[] }[] } };
  }>(`/${SEASON}/${round}/driverstandings/`, 86400);
  const out: Record<string, PrevStanding> = {};
  for (const s of d.MRData.StandingsTable.StandingsLists[0]?.DriverStandings ?? []) {
    out[s.Driver.driverId] = { pos: Number(s.position), points: Number(s.points) };
  }
  return out;
}

export async function getPrevConstructorStandings(round: number): Promise<Record<string, PrevStanding>> {
  if (round < 1) return {};
  const d = await get<{
    MRData: { StandingsTable: { StandingsLists: { ConstructorStandings: ConstructorStanding[] }[] } };
  }>(`/${SEASON}/${round}/constructorstandings/`, 86400);
  const out: Record<string, PrevStanding> = {};
  for (const s of d.MRData.StandingsTable.StandingsLists[0]?.ConstructorStandings ?? []) {
    out[s.Constructor.constructorId] = { pos: Number(s.position), points: Number(s.points) };
  }
  return out;
}

/** Winner of every completed race, in one call — `Map round → {code, name}`. */
export async function getSeasonWinners(): Promise<Record<number, { code: string; name: string }>> {
  const d = await get<{
    MRData: {
      RaceTable: {
        Races: { round: string; Results?: { Driver: { code?: string; familyName: string } }[] }[];
      };
    };
    // Short TTL on purpose: this doubles as the "has Jolpica ingested this round's RACE yet"
    // gate for the computed standings. Were it staler than the standings it guards (600s), the
    // two caches could straddle the moment Jolpica ingests — official totals already including
    // the race while this still said they didn't — and the points would be added twice.
  }>(`/${SEASON}/results/1/`, 120);
  const out: Record<number, { code: string; name: string }> = {};
  for (const r of d.MRData.RaceTable.Races ?? []) {
    const w = r.Results?.[0]?.Driver;
    if (w) out[Number(r.round)] = { code: w.code ?? w.familyName.slice(0, 3).toUpperCase(), name: w.familyName };
  }
  return out;
}

/** The round the standings are current through — used to know if the live projection is ahead. */
export async function getStandingsRound(): Promise<number> {
  try {
    const d = await get<{ MRData: { StandingsTable: { round?: string; StandingsLists: { round?: string }[] } } }>(
      `/${SEASON}/driverstandings/`,
    );
    const t = d.MRData.StandingsTable;
    return Number(t.StandingsLists[0]?.round ?? t.round ?? 0);
  } catch {
    return 0;
  }
}

export async function getSchedule(): Promise<Race[]> {
  const d = await get<{ MRData: { RaceTable: { Races: Race[] } } }>(`/${SEASON}/`);
  return d.MRData.RaceTable.Races ?? [];
}

/**
 * Next race — the first weekend that isn't over yet. Derived from the schedule by date
 * (not Jolpica's `/current/next/`, which keeps returning the just-finished race for days
 * until their backend rolls over). Rolls to the following round ~3.5 h after lights-out.
 */
export async function getNextRace(): Promise<Race | null> {
  try {
    const races = await getSchedule();
    const now = Date.now();
    // Backstop only (used when the live feed isn't available). Wide enough that it can
    // never roll over during a running/red-flagged race — the precise "5 min after the
    // race is actually not live" flip is driven by the socket in page.tsx.
    const RACE_OVER_MS = 6 * 3600_000;
    return races.find((r) => Date.parse(raceStartISO(r)) + RACE_OVER_MS > now) ?? null;
  } catch {
    return null;
  }
}

/** ISO datetime of a race's lights-out, combining date + time (UTC). */
export function raceStartISO(race: Race): string {
  return `${race.date}T${race.time ?? "12:00:00Z"}`;
}
