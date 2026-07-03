/**
 * OpenF1 — real-time & historical F1 telemetry, powering the live map + board.
 * Called through our own same-origin proxy (`/api/live/*`) because OpenF1 rejects
 * browser requests (Origin header → 401) and gates live sessions behind an API key.
 * Docs: https://openf1.org/
 */

const BASE = "/api/live";

/** Error that preserves the upstream HTTP status (401 = live-session lockout). */
export class OpenF1Error extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "OpenF1Error";
  }
}

export interface Session {
  session_key: number;
  session_type: string;
  session_name: string;
  date_start: string;
  date_end: string;
  meeting_key: number;
  circuit_short_name: string;
  country_name: string;
  location: string;
  year: number;
  is_cancelled: boolean;
}

export interface Driver {
  driver_number: number;
  broadcast_name: string;
  full_name: string;
  name_acronym: string;
  team_name: string;
  team_colour: string; // hex without '#'
  headshot_url: string | null;
}

export interface PositionRow {
  date: string;
  driver_number: number;
  position: number;
}

export interface IntervalRow {
  date: string;
  driver_number: number;
  gap_to_leader: string | number | null;
  interval: string | number | null;
}

export interface StintRow {
  driver_number: number;
  stint_number: number;
  lap_start: number;
  lap_end: number;
  compound: string; // SOFT | MEDIUM | HARD | INTERMEDIATE | WET
  tyre_age_at_start: number;
}

export interface LocationRow {
  date: string;
  driver_number: number;
  x: number;
  y: number;
  z: number;
}

export interface LapRow {
  driver_number: number;
  lap_number: number;
  lap_duration: number | null; // seconds; null on in/out laps
  duration_sector_1: number | null;
  duration_sector_2: number | null;
  duration_sector_3: number | null;
  st_speed: number | null; // speed-trap km/h
  is_pit_out_lap: boolean;
  date_start: string | null;
}

/** Best / last lap and lap count for one driver in the session so far. */
export interface LapSummary {
  best: number | null;
  last: number | null;
  bestS1: number | null;
  bestS2: number | null;
  bestS3: number | null;
  count: number;
}

async function get<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  const res = await fetch(`${BASE}${path}?${qs}`, { cache: "no-store" });
  if (!res.ok) throw new OpenF1Error(`OpenF1 ${path} → ${res.status}`, res.status);
  return (await res.json()) as T;
}

/**
 * OpenF1 filters ranges with operators baked into the key, e.g. `date>2026-...`.
 * We build those as raw key fragments so encodeURIComponent doesn't mangle them.
 */
function rangeQS(base: Record<string, string | number>, extra: string[]): string {
  const parts = Object.entries(base).map(
    ([k, v]) => `${k}=${encodeURIComponent(String(v))}`,
  );
  return [...parts, ...extra].join("&");
}

async function getRange<T>(path: string, qs: string): Promise<T> {
  const res = await fetch(`${BASE}${path}?${qs}`, { cache: "no-store" });
  if (!res.ok) throw new OpenF1Error(`OpenF1 ${path} → ${res.status}`, res.status);
  return (await res.json()) as T;
}

/* ----------------------------- Fetchers ----------------------------- */
export function getSessions(year: number): Promise<Session[]> {
  return get<Session[]>("/sessions", { year });
}

export function getDrivers(sessionKey: number): Promise<Driver[]> {
  return get<Driver[]>("/drivers", { session_key: sessionKey });
}

/** Stints for the whole session (small); latest stint per driver = current tyre. */
export function getStints(sessionKey: number): Promise<StintRow[]> {
  return get<StintRow[]>("/stints", { session_key: sessionKey });
}

/** Positions in a trailing window ending at `beforeISO`; reduce to latest per driver. */
export function getPositions(sessionKey: number, sinceISO: string, beforeISO: string) {
  const qs = rangeQS({ session_key: sessionKey }, [
    `date>${encodeURIComponent(sinceISO)}`,
    `date<${encodeURIComponent(beforeISO)}`,
  ]);
  return getRange<PositionRow[]>("/position", qs);
}

export function getIntervals(sessionKey: number, sinceISO: string, beforeISO: string) {
  const qs = rangeQS({ session_key: sessionKey }, [
    `date>${encodeURIComponent(sinceISO)}`,
    `date<${encodeURIComponent(beforeISO)}`,
  ]);
  return getRange<IntervalRow[]>("/intervals", qs);
}

/** Car locations in a short window (all drivers) → latest dot per driver. */
export function getLocations(sessionKey: number, sinceISO: string, beforeISO: string) {
  const qs = rangeQS({ session_key: sessionKey }, [
    `date>${encodeURIComponent(sinceISO)}`,
    `date<${encodeURIComponent(beforeISO)}`,
  ]);
  return getRange<LocationRow[]>("/location", qs);
}

/** All laps started before `beforeISO` → best/last lap per driver (fastest in quali/practice). */
export function getLaps(sessionKey: number, beforeISO: string) {
  const qs = rangeQS({ session_key: sessionKey }, [
    `date_start<${encodeURIComponent(beforeISO)}`,
  ]);
  return getRange<LapRow[]>("/laps", qs);
}

/** One driver's locations over a long window → used to trace the track outline. */
export function getTrackTrace(
  sessionKey: number,
  driverNumber: number,
  sinceISO: string,
  beforeISO: string,
) {
  const qs = rangeQS({ session_key: sessionKey, driver_number: driverNumber }, [
    `date>${encodeURIComponent(sinceISO)}`,
    `date<${encodeURIComponent(beforeISO)}`,
  ]);
  return getRange<LocationRow[]>("/location", qs);
}

/* ----------------------------- Reducers ----------------------------- */
/** Keep only the most recent row per driver_number from a time series. */
export function latestPerDriver<T extends { driver_number: number; date?: string }>(
  rows: T[],
): Map<number, T> {
  const out = new Map<number, T>();
  for (const r of rows) {
    const prev = out.get(r.driver_number);
    if (!prev || (r.date ?? "") > (prev.date ?? "")) out.set(r.driver_number, r);
  }
  return out;
}

/** Fold a session's laps into a best/last/count summary per driver. */
export function summarizeLaps(rows: LapRow[]): Map<number, LapSummary> {
  const out = new Map<number, LapSummary & { _lastNo: number }>();
  for (const r of rows) {
    let s = out.get(r.driver_number);
    if (!s) {
      s = { best: null, last: null, bestS1: null, bestS2: null, bestS3: null, count: 0, _lastNo: -1 };
      out.set(r.driver_number, s);
    }
    if (r.lap_number > s.count) s.count = r.lap_number;
    if (r.lap_duration != null) {
      if (s.best == null || r.lap_duration < s.best) s.best = r.lap_duration;
      if (r.lap_number > s._lastNo) {
        s._lastNo = r.lap_number;
        s.last = r.lap_duration;
      }
    }
    const s1 = r.duration_sector_1,
      s2 = r.duration_sector_2,
      s3 = r.duration_sector_3;
    if (s1 != null && (s.bestS1 == null || s1 < s.bestS1)) s.bestS1 = s1;
    if (s2 != null && (s.bestS2 == null || s2 < s.bestS2)) s.bestS2 = s2;
    if (s3 != null && (s.bestS3 == null || s3 < s.bestS3)) s.bestS3 = s3;
  }
  return out;
}

/** Current stint (highest stint_number) per driver → current compound & tyre age. */
export function currentStintPerDriver(rows: StintRow[]): Map<number, StintRow> {
  const out = new Map<number, StintRow>();
  for (const r of rows) {
    const prev = out.get(r.driver_number);
    if (!prev || r.stint_number > prev.stint_number) out.set(r.driver_number, r);
  }
  return out;
}
