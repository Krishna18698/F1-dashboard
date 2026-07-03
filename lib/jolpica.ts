/**
 * Jolpica-F1 (Ergast successor) — free, no key. Covers the 2026 season.
 * Used server-side for standings, calendar and next-race data.
 * Docs: https://github.com/jolpica/jolpica-f1
 */

const BASE = "https://api.jolpi.ca/ergast/f1";
export const SEASON = "2026";

// Revalidate hourly — this data only changes after a race weekend.
const REVALIDATE = 3600;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    next: { revalidate: REVALIDATE },
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

export async function getSchedule(): Promise<Race[]> {
  const d = await get<{ MRData: { RaceTable: { Races: Race[] } } }>(`/${SEASON}/`);
  return d.MRData.RaceTable.Races ?? [];
}

/** Next race, if the season isn't over. Falls back to null. */
export async function getNextRace(): Promise<Race | null> {
  try {
    const d = await get<{ MRData: { RaceTable: { Races: Race[] } } }>(`/current/next/`);
    return d.MRData.RaceTable.Races[0] ?? null;
  } catch {
    return null;
  }
}

/** ISO datetime of a race's lights-out, combining date + time (UTC). */
export function raceStartISO(race: Race): string {
  return `${race.date}T${race.time ?? "12:00:00Z"}`;
}
