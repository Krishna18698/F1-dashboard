"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { Driver, IntervalRow, LapSummary, StintRow } from "@/lib/openf1";
import { F1_LIVE } from "@/lib/f1liveConfig";
import type { LiveState } from "./useLiveSession";
import { pushFrames } from "./framesStore";

interface ApiRow {
  driver_number: number;
  position: number;
  gap_to_leader: string;
  interval: string;
  best: number | null;
  last: number | null;
  laps: number;
  compound: string;
  tyre_laps: number;
  in_pit: boolean;
}
interface ApiDriver {
  driver_number: number;
  name_acronym: string;
  team_colour: string;
  team_name: string;
  full_name: string;
}
interface ApiResponse {
  status: "live" | "idle" | "error";
  replay?: boolean;
  mode?: LiveState["mode"];
  circuitKey?: number;
  session?: { location: string; session_name: string };
  drivers?: ApiDriver[];
  order?: number[];
  rows?: Record<number, ApiRow>;
  frames?: { t: number; c: Record<string, [number, number]> }[];
}

const empty: LiveState = {
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

function toState(r: ApiResponse): LiveState {
  const drivers = new Map<number, Driver>();
  for (const d of r.drivers ?? []) {
    drivers.set(d.driver_number, {
      driver_number: d.driver_number,
      name_acronym: d.name_acronym,
      team_colour: d.team_colour,
      team_name: d.team_name,
      full_name: d.full_name,
      broadcast_name: d.full_name,
      headshot_url: null,
    });
  }

  const positions = new Map<number, number>();
  const intervals = new Map<number, IntervalRow>();
  const stints = new Map<number, StintRow>();
  const tyreLaps = new Map<number, number>();
  const inPit = new Set<number>();
  const laps = new Map<number, LapSummary>();
  for (const [numStr, row] of Object.entries(r.rows ?? {})) {
    const num = +numStr;
    positions.set(num, row.position);
    tyreLaps.set(num, row.tyre_laps ?? 0);
    if (row.in_pit) inPit.add(num);
    intervals.set(num, {
      date: "",
      driver_number: num,
      gap_to_leader: row.gap_to_leader || null,
      interval: row.interval || null,
    });
    stints.set(num, {
      driver_number: num,
      stint_number: 0,
      lap_start: 0,
      lap_end: 0,
      compound: row.compound,
      tyre_age_at_start: 0,
    });
    laps.set(num, { best: row.best, last: row.last, count: row.laps, bestS1: null, bestS2: null, bestS3: null });
  }

  return {
    status: "live",
    replay: r.replay,
    circuitKey: r.circuitKey,
    frames: [], // positions live in framesStore now, not React state (keeps the map smooth)
    mode: r.mode ?? "race",
    session: r.session
      ? ({ location: r.session.location, session_name: r.session.session_name } as unknown as LiveState["session"])
      : undefined,
    drivers,
    order: r.order ?? [],
    positions,
    intervals,
    stints,
    tyreLaps,
    inPit,
    locations: new Map(),
    laps,
    trace: [],
  };
}

export function useF1Live(): LiveState {
  const [state, setState] = useState<LiveState>(empty);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    let timer: ReturnType<typeof setTimeout>;

    // Poll fast only while a session is live; back off hard when idle so we're not
    // hammering the feed when nothing is happening.
    const IDLE_MS = 30_000;

    async function poll() {
      let status: ApiResponse["status"] = "idle";
      try {
        const res = await fetch("/api/f1live", { cache: "no-store" });
        const data = (await res.json()) as ApiResponse;
        if (cancelled.current) return;
        status = data.status;
        if (data.status === "idle" || data.status === "error") {
          setState((s) => ({ ...s, status: data.status }));
        } else {
          // Feed the map's animation buffer directly — NOT through React state — so the
          // heavy position payload never triggers a re-render or stalls the 60fps loop.
          pushFrames(data.frames);
          // Table/tyre data is non-urgent: let React yield to the map animation.
          startTransition(() => setState(toState(data)));
        }
      } catch {
        if (!cancelled.current) setState((s) => ({ ...s, status: "error" }));
      }
      if (!cancelled.current) {
        timer = setTimeout(poll, status === "live" ? F1_LIVE.pollMs : IDLE_MS);
      }
    }

    poll();
    return () => {
      cancelled.current = true;
      clearTimeout(timer);
    };
  }, []);

  return state;
}
