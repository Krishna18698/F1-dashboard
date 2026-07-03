"use client";

import { useEffect, useRef, useState } from "react";
import { Driver, IntervalRow, LapSummary, LocationRow, StintRow } from "@/lib/openf1";
import { F1_LIVE } from "@/lib/f1liveConfig";
import type { LiveState } from "./useLiveSession";

interface ApiRow {
  driver_number: number;
  position: number;
  gap_to_leader: string;
  interval: string;
  best: number | null;
  last: number | null;
  laps: number;
  compound: string;
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
  session?: { location: string; session_name: string };
  drivers?: ApiDriver[];
  order?: number[];
  rows?: Record<number, ApiRow>;
  cars?: { driver_number: number; x: number; y: number }[];
  trace?: { x: number; y: number }[];
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
  const laps = new Map<number, LapSummary>();
  for (const [numStr, row] of Object.entries(r.rows ?? {})) {
    const num = +numStr;
    positions.set(num, row.position);
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

  const locations = new Map<number, LocationRow>();
  for (const c of r.cars ?? []) {
    locations.set(c.driver_number, { date: "", driver_number: c.driver_number, x: c.x, y: c.y, z: 0 });
  }

  return {
    status: "live",
    replay: r.replay,
    mode: r.mode ?? "race",
    session: r.session
      ? ({ location: r.session.location, session_name: r.session.session_name } as unknown as LiveState["session"])
      : undefined,
    drivers,
    order: r.order ?? [],
    positions,
    intervals,
    stints,
    locations,
    laps,
    trace: r.trace ?? [],
  };
}

export function useF1Live(): LiveState {
  const [state, setState] = useState<LiveState>(empty);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;

    async function poll() {
      try {
        const res = await fetch("/api/f1live", { cache: "no-store" });
        const data = (await res.json()) as ApiResponse;
        if (cancelled.current) return;
        if (data.status === "idle") return setState((s) => ({ ...s, status: "idle" }));
        if (data.status === "error") return setState((s) => ({ ...s, status: "error" }));
        setState(toState(data));
      } catch {
        if (!cancelled.current) setState((s) => ({ ...s, status: "error" }));
      }
    }

    poll();
    const timer = setInterval(poll, F1_LIVE.pollMs);
    return () => {
      cancelled.current = true;
      clearInterval(timer);
    };
  }, []);

  return state;
}
