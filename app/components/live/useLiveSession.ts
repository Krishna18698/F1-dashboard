"use client";

import { useEffect, useRef, useState } from "react";
import {
  Driver,
  IntervalRow,
  LapSummary,
  LocationRow,
  PositionRow,
  Session,
  StintRow,
  currentStintPerDriver,
  getDrivers,
  getIntervals,
  getLaps,
  getLocations,
  getPositions,
  getSessions,
  getStints,
  getTrackTrace,
  latestPerDriver,
  summarizeLaps,
  OpenF1Error,
} from "@/lib/openf1";
import { LIVE_CONFIG } from "@/lib/liveConfig";

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
  source?: "token" | "free"; // which feed is powering this — token = real-time, free = public fallback
  circuitKey?: number;
  session?: Session;
  clockISO?: string;
  drivers: Map<number, Driver>;
  order: number[]; // driver_numbers, ordered by position (race) or best lap (quali/practice)
  positions: Map<number, number>;
  intervals: Map<number, IntervalRow>;
  stints: Map<number, StintRow>;
  tyreStints?: Map<number, { compound: string; laps: number; age: number; isNew: boolean; segment: number | null }[]>; // full tyre history per driver
  totalLaps?: number; // race distance (strategy-bar axis)
  currentLap?: number;
  grids?: Map<number, number>; // starting grid position per driver (gained/lost indicator)
  fastestLap?: { driver_number: number; tla: string; time: string; lap: number } | null;
  trackStatus?: string | null; // TrackStatus code — tints the map (yellow/SC/red)
  qualifyingPart?: number | null; // 1=Q1, 2=Q2, 3=Q3 (quali sessions only)
  qualifyingRemainingMs?: number | null; // live countdown in the current segment
  tyreLaps?: Map<number, number>; // laps on current tyre, per driver
  inPit?: Set<number>; // drivers currently in the pit lane
  retired?: Set<number>; // crashed / DNF drivers
  knockedOut?: Set<number>; // eliminated in a prior quali segment
  locations: Map<number, LocationRow>;
  frames?: PosFrame[]; // recent position window for smooth playback
  laps: Map<number, LapSummary>;
  trace: { x: number; y: number }[]; // one lap, for the track outline
  nextInfo?: { name: string; startISO: string };
}

/** Race & Sprint → intervals view; Qualifying / Practice → best-lap view. */
function sessionMode(type?: string): SessionMode {
  const t = (type ?? "").toLowerCase();
  if (t.includes("qual")) return "quali";
  if (t.includes("practice")) return "practice";
  return "race";
}

const emptyState: LiveState = {
  status: "loading",
  mode: "race",
  drivers: new Map(),
  order: [],
  positions: new Map(),
  intervals: new Map(),
  stints: new Map(),
  locations: new Map(),
  laps: new Map(),
  trace: [],
};

function iso(ms: number) {
  return new Date(ms).toISOString();
}

/** Pick the session that is live right now, or the next upcoming one. */
function chooseSession(sessions: Session[], nowMs: number) {
  const valid = sessions.filter((s) => !s.is_cancelled);
  const live = valid.find((s) => {
    const start = Date.parse(s.date_start);
    const end = Date.parse(s.date_end);
    return nowMs >= start - 5 * 60_000 && nowMs <= end + 5 * 60_000;
  });
  if (live) return { session: live, live: true as const };
  const upcoming = valid
    .filter((s) => Date.parse(s.date_start) > nowMs)
    .sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start))[0];
  return { session: upcoming, live: false as const };
}

export function useLiveSession(): LiveState {
  const [state, setState] = useState<LiveState>(emptyState);

  // Stable references across renders. pageLoad is set once inside the effect
  // (reading the clock during render would be impure).
  const pageLoadRef = useRef<number>(0);
  const driversRef = useRef<Map<number, Driver>>(new Map());
  const traceRef = useRef<{ x: number; y: number }[]>([]);
  // Persistent "last known" values — position/interval rows only arrive on change,
  // so we accumulate them across polls rather than rebuilding from one window.
  const posRef = useRef<Map<number, PositionRow>>(new Map());
  const intRef = useRef<Map<number, IntervalRow>>(new Map());
  const locRef = useRef<Map<number, LocationRow>>(new Map());

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    pageLoadRef.current = Date.now();

    const { replay, pollMs, year } = LIVE_CONFIG;

    /** The "current instant" we query up to — virtual in replay, real otherwise. */
    const nowMs = () =>
      replay.enabled
        ? Date.parse(replay.anchorISO) + (Date.now() - pageLoadRef.current) * replay.speed
        : Date.now();

    async function init() {
      try {
        const sessions = await getSessions(year);
        if (cancelled) return;

        let session: Session | undefined;
        let live: boolean;

        if (replay.enabled) {
          session = sessions.find((s) => s.session_key === replay.sessionKey);
          live = true;
        } else {
          const chosen = chooseSession(sessions, nowMs());
          session = chosen.session;
          live = chosen.live;
        }

        if (!session) {
          setState((s) => ({ ...s, status: "idle" }));
          return;
        }

        if (!live) {
          setState((s) => ({
            ...s,
            status: "idle",
            session,
            nextInfo: {
              name: `${session!.location} · ${session!.session_name}`,
              startISO: session.date_start,
            },
          }));
          return;
        }

        // Live: load static driver metadata once, then start polling.
        const drivers = await getDrivers(session.session_key);
        if (cancelled) return;
        driversRef.current = new Map(drivers.map((d) => [d.driver_number, d]));

        await poll(session);
        timer = setInterval(() => poll(session!), pollMs);
      } catch (e) {
        if (cancelled) return;
        // 401 = OpenF1 locks free access while a session is actually running.
        const restricted = e instanceof OpenF1Error && e.status === 401;
        setState((s) => ({ ...s, status: restricted ? "restricted" : "error" }));
      }
    }

    async function poll(session: Session) {
      try {
        const end = nowMs();
        const endISO = iso(end);
        const key = session.session_key;

        // Build the track outline once from a ~110s trace of one driver.
        if (traceRef.current.length === 0) {
          const anyDriver = driversRef.current.keys().next().value;
          if (anyDriver !== undefined) {
            const trace = await getTrackTrace(key, anyDriver, iso(end - 115_000), endISO);
            traceRef.current = trace
              .filter((p) => p.x !== 0 || p.y !== 0)
              .map((p) => ({ x: p.x, y: p.y }));
          }
        }

        const mode = sessionMode(session.session_type);

        const [locRows, posRows, intRows, stintRows, lapRows] = await Promise.all([
          getLocations(key, iso(end - 6_000), endISO),
          getPositions(key, iso(end - 120_000), endISO),
          getIntervals(key, iso(end - 120_000), endISO),
          getStints(key),
          getLaps(key, endISO),
        ]);
        if (cancelled) return;

        // Merge newest rows into persistent maps (rows only arrive on change).
        for (const [num, row] of latestPerDriver(locRows)) locRef.current.set(num, row);
        for (const [num, row] of latestPerDriver(posRows)) posRef.current.set(num, row);
        for (const [num, row] of latestPerDriver(intRows)) intRef.current.set(num, row);

        const locations = new Map(locRef.current);
        const positions = new Map<number, number>();
        for (const [num, row] of posRef.current) positions.set(num, row.position);
        const intervals = new Map(intRef.current);
        const stints = currentStintPerDriver(stintRows);
        const laps = summarizeLaps(lapRows);

        // Race → order by track position; Quali/Practice → order by fastest lap.
        const order = [...driversRef.current.keys()].sort((a, b) => {
          if (mode === "race") return (positions.get(a) ?? 99) - (positions.get(b) ?? 99);
          return (laps.get(a)?.best ?? Infinity) - (laps.get(b)?.best ?? Infinity);
        });

        setState({
          status: "live",
          mode,
          session,
          clockISO: endISO,
          drivers: driversRef.current,
          order,
          positions,
          intervals,
          stints,
          locations,
          laps,
          trace: traceRef.current,
        });
      } catch {
        // Transient poll failure — keep last good state, try again next tick.
      }
    }

    init();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  return state;
}
