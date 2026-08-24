/**
 * Shape of the live/replay session state the UI renders.
 *
 * These types are all that survived `useLiveSession()` — a second, OpenF1-based engine that
 * duplicated the live and replay paths and was never called: only its types were ever imported.
 * It carried its own `LIVE_CONFIG.replay.enabled`, left at `true` while the real test-replay
 * switch sat at `false`, so anyone opening the wrong file concluded test replay was on.
 *
 * The engine and its config are gone. What renders today comes from `useF1Live`, fed by
 * lib/live/* and lib/replay/*.
 */
import type { Driver, IntervalRow, LapSummary, LocationRow, Session, StintRow } from "@/lib/timingTypes";

export type LiveStatus = "loading" | "live" | "idle" | "error" | "restricted";
export type SessionMode = "race" | "quali" | "practice";

/** A timestamped position frame — the client plays these back smoothly on a delay. */
export interface PosFrame {
  t: number; // epoch ms
  c: Record<string, [number, number]>; // driver_number → [x, y]
}

export interface LiveState {
  status: LiveStatus;
  mode: SessionMode;
  replay?: boolean; // true when showing a past session (nothing live right now)
  source?: "token" | "free" | "visitor" | "free-live"; // which feed is powering this — token = owner's, visitor = their own, free = public static fallback, free-live = F1's live hub with no token (real-time timing, no map)
  mapAvailable?: boolean; // false when the feed can't supply car positions at all (anonymous hub connection — F1 gates Position.z behind a token)
  sessionEnded?: boolean; // session is over but still F1's current one — board shows a FINAL classification
  segmentEvents?: { t: number; n: number; s: number; i: number; c: number }[]; // mini-sectors published but not yet reached by the car dots
  lapResets?: { t: number; n: number }[]; // line crossings ahead of the dots, so the card can blank on time
  circuitKey?: number;
  session?: Session;
  clockISO?: string;
  drivers: Map<number, Driver>;
  order: number[]; // driver_numbers, ordered by position (race) or best lap (quali/practice)
  positions: Map<number, number>;
  intervals: Map<number, IntervalRow>;
  stints: Map<number, StintRow>;
  tyreStints?: Map<number, { compound: string; laps: number; age: number; isNew: boolean; segment: number | null }[]>; // full tyre history per driver
  weekendTyresLeft?: Map<number, { compound: string; left: number }[]>; // sets remaining vs. the assumed weekend allocation, per compound
  totalLaps?: number; // race distance (strategy-bar axis)
  currentLap?: number;
  grids?: Map<number, number>; // starting grid position per driver (gained/lost indicator)
  fastestLap?: { driver_number: number; tla: string; time: string; lap: number } | null;
  trackStatus?: string | null; // TrackStatus code — tints the map (yellow/SC/red)
  /** F1's own SessionStatus. "Aborted" is the authoritative red-flag/suspension signal —
   *  TrackStatus is NOT: it returns to "1" (green) once marshals clear the track, while the
   *  race is still stopped and the cars are queued in the pit lane. */
  sessionStatus?: string | null;
  /** Announced restart instant (epoch ms) while suspended, else null. */
  suspendedRestartMs?: number | null;
  formationLap?: boolean; // race hasn't gone green yet — tints the map yellow, like a flag
  qualifyingPart?: number | null; // 1=Q1, 2=Q2, 3=Q3 (quali sessions only)
  qualifyingRemainingMs?: number | null; // live countdown in the current segment
  qualifyingSegmentEnded?: boolean; // segment clock ran out, next hasn't started yet
  nextQualifyingSegmentInMs?: number | null; // estimated countdown to the next segment
  tokenIssue?: "invalid" | "busy" | null; // set when a visitor's own token couldn't be used
  ownerTokenConfigured?: boolean; // does the SITE have its own F1_TV_TOKEN configured
  scheduledLive?: { location: string; session_name: string } | null; // a session is on by the schedule right now, even though there's no data to show yet (no token / free feed hasn't caught up)
  tyreLaps?: Map<number, number>; // laps on current tyre, per driver
  sectors?: Map<number, { value: string; overallFastest: boolean; personalFastest: boolean; segments: number[] }[]>; // S1/S2/S3 with F1's purple/green flags
  bestSectors?: Map<number, (number | null)[]>; // best S1/S2/S3 of the session, per driver, in seconds
  speeds?: Map<number, Record<string, { value: string; overallFastest: boolean; personalFastest: boolean }>>; // I1/I2/FL/ST speed traps
  inPit?: Set<number>; // drivers currently in the pit lane
  retired?: Set<number>; // crashed / DNF drivers
  knockedOut?: Set<number>; // eliminated in a prior quali segment
  locations: Map<number, LocationRow>;
  frames?: PosFrame[]; // recent position window for smooth playback
  laps: Map<number, LapSummary>;
  trace: { x: number; y: number }[]; // one lap, for the track outline
  nextInfo?: { name: string; startISO: string };
}

