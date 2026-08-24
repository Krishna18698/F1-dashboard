/**
 * Timing data shapes, originally modelled on the OpenF1 schema.
 *
 * NOTHING here calls OpenF1 any more. The app's data comes from F1's own live-timing socket
 * (lib/live/liveSocket.ts) and its published archive (lib/archive/archiveParser.ts). The
 * fetchers that once hit api.openf1.org went with `useLiveSession()`, the duplicate engine
 * nobody called. These interfaces stayed because the whole live UI is typed against them, and
 * they are reproduced EXACTLY as they were — no field re-typed in the move.
 *
 * Pure type module: no imports, no network, no runtime cost.
 */

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

/** Best / last lap and lap count for one driver in the session so far. */
export interface LapSummary {
  best: number | null;
  last: number | null;
  bestS1: number | null;
  bestS2: number | null;
  bestS3: number | null;
  count: number;
}
