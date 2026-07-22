"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { Driver, IntervalRow, LapSummary, StintRow } from "@/lib/openf1";
import { F1_LIVE } from "@/lib/f1liveConfig";
import { getStoredVisitorToken } from "@/lib/visitorToken";
import type { LiveState } from "./useLiveSession";
import { newestFrameT, pushFrames, pushTel, resetFrames } from "./framesStore";

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
  retired?: boolean;
  knocked_out?: boolean;
  grid?: number;
  stints?: { compound: string; laps: number; age: number; isNew: boolean; segment: number | null }[];
  weekendTyresLeft?: { compound: string; left: number }[];
}
interface ApiFastest {
  driver_number: number;
  tla: string;
  time: string;
  lap: number;
}
interface ApiDriver {
  driver_number: number;
  name_acronym: string;
  team_colour: string;
  team_name: string;
  full_name: string;
}
interface ApiResponse {
  // "token_invalid"/"token_busy" never appear as the top-level status — a rejected visitor
  // token still falls through to whatever the site would otherwise show; see `tokenIssue`.
  status: "live" | "idle" | "error";
  replay?: boolean;
  source?: "token" | "free" | "visitor";
  mode?: LiveState["mode"];
  circuitKey?: number;
  session?: { location: string; session_name: string };
  drivers?: ApiDriver[];
  order?: number[];
  rows?: Record<number, ApiRow>;
  frames?: { t: number; c: Record<string, [number, number]> }[];
  totalLaps?: number;
  currentLap?: number;
  fastestLap?: ApiFastest | null;
  trackStatus?: string | null;
  telFrames?: { t: number; c: Record<string, [number, number, number, number]> }[];
  qualifyingPart?: number | null;
  qualifyingRemainingMs?: number | null;
  tokenIssue?: "invalid" | "busy";
  ownerTokenConfigured?: boolean;
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
  const grids = new Map<number, number>();
  const intervals = new Map<number, IntervalRow>();
  const stints = new Map<number, StintRow>();
  const tyreStints = new Map<number, { compound: string; laps: number; age: number; isNew: boolean; segment: number | null }[]>();
  const weekendTyresLeft = new Map<number, { compound: string; left: number }[]>();
  const tyreLaps = new Map<number, number>();
  const inPit = new Set<number>();
  const retired = new Set<number>();
  const knockedOut = new Set<number>();
  const laps = new Map<number, LapSummary>();
  for (const [numStr, row] of Object.entries(r.rows ?? {})) {
    const num = +numStr;
    positions.set(num, row.position);
    grids.set(num, row.grid ?? 0);
    tyreLaps.set(num, row.tyre_laps ?? 0);
    if (row.retired) retired.add(num);
    if (row.knocked_out) knockedOut.add(num);
    // Full history from the token feed; otherwise synthesize one stint from the current tyre.
    tyreStints.set(
      num,
      row.stints?.length
        ? row.stints
        : [{ compound: row.compound, laps: row.tyre_laps ?? 0, age: row.tyre_laps ?? 0, isNew: false, segment: null }],
    );
    if (row.weekendTyresLeft) weekendTyresLeft.set(num, row.weekendTyresLeft);
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
    source: r.source,
    circuitKey: r.circuitKey,
    frames: [], // positions live in framesStore now, not React state (keeps the map smooth)
    mode: r.mode ?? "race",
    session: r.session
      ? ({ location: r.session.location, session_name: r.session.session_name } as unknown as LiveState["session"])
      : undefined,
    drivers,
    order: r.order ?? [],
    positions,
    grids,
    intervals,
    stints,
    tyreStints,
    weekendTyresLeft,
    totalLaps: r.totalLaps ?? 0,
    currentLap: r.currentLap ?? 0,
    fastestLap: r.fastestLap ?? null,
    trackStatus: r.trackStatus ?? null,
    qualifyingPart: r.qualifyingPart ?? null,
    qualifyingRemainingMs: r.qualifyingRemainingMs ?? null,
    tokenIssue: r.tokenIssue ?? null,
    ownerTokenConfigured: r.ownerTokenConfigured ?? false,
    tyreLaps,
    inPit,
    retired,
    knockedOut,
    locations: new Map(),
    laps,
    trace: [],
  };
}

export function useF1Live(view: "live" | "replay" = "live", replayT0?: number): LiveState {
  const [state, setState] = useState<LiveState>(empty);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    let timer: ReturnType<typeof setTimeout>;
    // Switching view (live <-> replay) is a different data stream/clock entirely — drop
    // any buffered positions and show "loading" instead of a stale frame from the other
    // view while the first poll for the new one is in flight. Deferred to a timer callback,
    // not called synchronously in the effect body (same pattern as elsewhere in this file's
    // sibling components).
    resetFrames();
    const resetId = setTimeout(() => setState(empty), 0);

    // Poll fast only while a session is live; back off hard when idle so we're not
    // hammering the feed when nothing is happening.
    const IDLE_MS = 30_000;

    async function poll() {
      let status: ApiResponse["status"] = "idle";
      // Tab hidden → don't hit the server (and rAF is paused anyway); re-check soon.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        if (!cancelled.current) timer = setTimeout(poll, 5_000);
        return;
      }
      try {
        // Incremental: ask only for frames newer than what we've buffered — keeps each
        // poll's payload/parse tiny so it never steals an animation frame. Attach the
        // visitor's own token (if they've saved one) as a header — never a query param —
        // so it never lands in a URL/log; read fresh from localStorage every poll so
        // saving/removing it in another tab takes effect on the next tick.
        const myToken = getStoredVisitorToken();
        const t0Param = view === "replay" && replayT0 ? `&t0=${replayT0}` : "";
        const res = await fetch(`/api/f1live?since=${newestFrameT()}&view=${view}${t0Param}`, {
          cache: "no-store",
          headers: myToken ? { "X-F1-Token": myToken } : undefined,
        });
        const data = (await res.json()) as ApiResponse;
        if (cancelled.current) return;
        status = data.status;
        if (data.status === "idle" || data.status === "error") {
          setState((s) => ({
            ...s,
            status: data.status,
            tokenIssue: data.tokenIssue ?? null,
            ownerTokenConfigured: data.ownerTokenConfigured ?? false,
          }));
        } else {
          // Feed the map's animation buffer directly — NOT through React state — so the
          // heavy position payload never triggers a re-render or stalls the 60fps loop.
          pushFrames(data.frames);
          pushTel(data.telFrames);
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
      clearTimeout(resetId);
    };
  }, [view, replayT0]);

  return state;
}
