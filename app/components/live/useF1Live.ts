"use client";

import { startTransition, useEffect, useState } from "react";
import { Driver, IntervalRow, LapSummary, StintRow } from "@/lib/timingTypes";
import { F1_LIVE } from "@/lib/live/liveConfig";
import { getStoredVisitorToken } from "@/lib/visitorToken";
import type { LiveState, ReplayInfo } from "./liveTypes";
import {
  framesEpoch,
  getPlaybackT,
  newestFrameT,
  pushFrames,
  pushTel,
  replayActive,
  replayNow,
  replayRate,
  resetFrames,
  setReplayClock,
  stopReplayClock,
  subscribeReplayClock,
} from "./framesStore";

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
  best_compound?: string | null;
  prev_best?: number | null;
  prev_best_compound?: string | null;
  retired?: boolean;
  knocked_out?: boolean;
  took_flag?: boolean;
  grid?: number;
  stints?: { compound: string; laps: number; age: number; isNew: boolean; segment: number | null }[];
  weekendTyresLeft?: { compound: string; left: number }[];
  sectors?: { value: string; overallFastest: boolean; personalFastest: boolean; segments: number[] }[];
  bestSectors?: (number | null)[];
  speeds?: Record<string, { value: string; overallFastest: boolean; personalFastest: boolean }>;
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
/** One moment's changes to the board, due at `t` on the map's clock. */
interface BoardChange {
  t: number;
  rows?: Record<string, Partial<ApiRow>>;
  order?: number[];
  currentLap?: number;
  trackStatus?: string | null;
  sessionStatus?: string | null;
  fastestLap?: ApiFastest | null;
}

interface ApiResponse {
  // "token_invalid"/"token_busy" never appear as the top-level status — a rejected visitor
  // token still falls through to whatever the site would otherwise show; see `tokenIssue`.
  status: "live" | "idle" | "error";
  replay?: boolean;
  source?: "token" | "free" | "visitor" | "free-live";
  mapAvailable?: boolean;
  sectorsSynced?: boolean;
  sessionEnded?: boolean;
  segmentEvents?: { t: number; n: number; s: number; i: number; c: number }[];
  lapResets?: { t: number; n: number }[];
  sectorEvents?: { t: number; n: number; s: { value: string; overallFastest: boolean; personalFastest: boolean; segments: number[] }[] }[];
  ahead?: BoardChange[];
  weather?: { air: number; track: number; rain: boolean } | null;
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
  sessionStatus?: string | null;
  suspendedRestartMs?: number | null;
  formationLap?: boolean;
  startDelayed?: boolean;
  startSuspended?: boolean;
  restartLabel?: string | null;
  telFrames?: { t: number; c: Record<string, [number, number, number, number]> }[];
  replayInfo?: ReplayInfo;
  qualifyingPart?: number | null;
  qualifyingRemainingMs?: number | null;
  sessionRemainingMs?: number | null;
  sessionClockRunning?: boolean | null;
  qualifyingSegmentEnded?: boolean;
  nextQualifyingSegmentInMs?: number | null;
  tokenIssue?: "invalid" | "busy";
  ownerTokenConfigured?: boolean;
  scheduledLive?: { location: string; session_name: string } | null;
  archiveLocked?: boolean;
  replayLiveBlocked?: boolean;
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
  const sectors = new Map<number, { value: string; overallFastest: boolean; personalFastest: boolean; segments: number[] }[]>();
  const bestSectors = new Map<number, (number | null)[]>();
  const speeds = new Map<number, Record<string, { value: string; overallFastest: boolean; personalFastest: boolean }>>();
  const inPit = new Set<number>();
  const retired = new Set<number>();
  const knockedOut = new Set<number>();
  const tookFlag = new Set<number>();
  const laps = new Map<number, LapSummary>();
  for (const [numStr, row] of Object.entries(r.rows ?? {})) {
    const num = +numStr;
    positions.set(num, row.position);
    grids.set(num, row.grid ?? 0);
    tyreLaps.set(num, row.tyre_laps ?? 0);
    if (row.retired) retired.add(num);
    if (row.knocked_out) knockedOut.add(num);
    if (row.took_flag) tookFlag.add(num);
    // Full history from the token feed; otherwise synthesize one stint from the current tyre.
    tyreStints.set(
      num,
      row.stints?.length
        ? row.stints
        : [{ compound: row.compound, laps: row.tyre_laps ?? 0, age: row.tyre_laps ?? 0, isNew: false, segment: null }],
    );
    if (row.weekendTyresLeft) weekendTyresLeft.set(num, row.weekendTyresLeft);
    // Live sectors arrive before the map's clock is known; with a map coming they'd show ~20 s
    // ahead and then jump back, so wait for the synced ones.
    if (row.sectors && !(r.sectorsSynced === false && r.mapAvailable !== false)) sectors.set(num, row.sectors);
    if (row.bestSectors) bestSectors.set(num, row.bestSectors);
    if (row.speeds) speeds.set(num, row.speeds);
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
    laps.set(num, { best: row.best, last: row.last, count: row.laps, bestS1: null, bestS2: null, bestS3: null, bestCompound: row.best_compound ?? null, prevBest: row.prev_best ?? null, prevBestCompound: row.prev_best_compound ?? null });
  }

  return {
    status: "live",
    replay: r.replay,
    source: r.source,
    mapAvailable: r.mapAvailable,
    sessionEnded: r.sessionEnded,
    segmentEvents: r.segmentEvents ?? [],
    lapResets: r.lapResets ?? [],
    sectorEvents: r.sectorEvents ?? [],
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
    weather: r.weather ?? null,
    sessionStatus: r.sessionStatus ?? null,
    suspendedRestartMs: r.suspendedRestartMs ?? null,
    formationLap: r.formationLap ?? false,
    startDelayed: r.startDelayed ?? false,
    startSuspended: r.startSuspended ?? false,
    restartLabel: r.restartLabel ?? null,
    qualifyingPart: r.qualifyingPart ?? null,
    qualifyingRemainingMs: r.qualifyingRemainingMs ?? null,
    sessionRemainingMs: r.sessionRemainingMs ?? null,
    sessionClockRunning: r.sessionClockRunning ?? null,
    qualifyingSegmentEnded: r.qualifyingSegmentEnded ?? false,
    nextQualifyingSegmentInMs: r.nextQualifyingSegmentInMs ?? null,
    tokenIssue: r.tokenIssue ?? null,
    ownerTokenConfigured: r.ownerTokenConfigured ?? false,
    tyreLaps,
    sectors,
    bestSectors,
    speeds,
    inPit,
    retired,
    knockedOut,
    tookFlag,
    locations: new Map(),
    laps,
    trace: [],
  };
}

/**
 * `serverKnowsNothingLive` seeds the very first render.
 *
 * Everything else on the page is server-rendered and paints at once, while this section had to
 * wait for the JS bundle, hydration, and its own first poll (~0.5 s) before it could say "no
 * session" — so it visibly lagged the rest of the page every time nothing was on track. The
 * server already knows the answer: page.tsx has liveStatus in hand when it renders. Passing it
 * in lets the section open on the idle state instead of a spinner, exactly as the hero does
 * with initialLiveStatus. Polling still starts immediately and overwrites this the moment a
 * real answer lands, so a session starting between render and hydration is not missed.
 */
export function useF1Live(
  view: "live" | "replay" = "live",
  replayT0?: number,
  serverKnowsNothingLive = false,
  /** The session picked for a replay (null: the most recent race). */
  replaySession: { path: string; year: number } | null = null,
): LiveState {
  const [state, setState] = useState<LiveState>(
    serverKnowsNothingLive && view === "live" ? { ...empty, status: "idle" } : empty,
  );

  useEffect(() => {
    // Scoped to THIS effect instance, not a shared ref across re-runs — a stale in-flight
    // fetch from the PREVIOUS view (e.g. replay) must stay blocked by ITS OWN flag even
    // after the new view's effect has started, or switching views mid-request could apply
    // the old view's response after the toggle already flipped (shown as "LIVE" selected
    // while still rendering replay data — a real race that shipped and was reported).
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    // Aborts this effect's request when the view changes or the section unmounts.
    const aborter = new AbortController();
    // The last poll's answer, and the changes it said are coming. The server is ~20 s ahead of
    // the map, so each poll brings what's due before the next one; they're applied here as the
    // map's clock reaches them, keeping every card with the cars rather than up to a poll
    // behind. The next poll replaces all of it, so nothing here can drift.
    let shown: ApiResponse | null = null;
    let shownEpoch = 0;
    let boardDue: BoardChange[] = [];
    let sectorsDue: NonNullable<ApiResponse["sectorEvents"]> = [];
    const applyDue = () => {
      const base = shown;
      const pt = getPlaybackT();
      // A jump in a replay leaves these describing the old position: the next poll replaces them.
      if (!base || !pt || shownEpoch !== framesEpoch()) return;
      if (!(boardDue[0]?.t <= pt) && !(sectorsDue[0]?.t <= pt)) return;
      const next: ApiResponse = { ...base, rows: { ...base.rows } };
      const rows = next.rows!;
      while (boardDue[0]?.t <= pt) {
        const c = boardDue.shift()!;
        for (const [n, r] of Object.entries(c.rows ?? {})) if (rows[+n]) rows[+n] = { ...rows[+n], ...r };
        if (c.order) next.order = c.order;
        if (c.currentLap !== undefined) next.currentLap = c.currentLap;
        if (c.trackStatus !== undefined) next.trackStatus = c.trackStatus;
        if (c.sessionStatus !== undefined) next.sessionStatus = c.sessionStatus;
        if (c.fastestLap !== undefined) next.fastestLap = c.fastestLap;
      }
      while (sectorsDue[0]?.t <= pt) {
        const e = sectorsDue.shift()!;
        if (rows[e.n]) rows[e.n] = { ...rows[e.n], sectors: e.s };
      }
      shown = next;
      const state = toState(next);
      startTransition(() =>
        setState((prev) =>
          prev.status === "live" ? { ...state, replayInfo: prev.replayInfo, updatedAt: prev.updatedAt, reconnecting: prev.reconnecting, epoch: shownEpoch } : prev,
        ),
      );
    };
    const dueTimer = setInterval(applyDue, 250);
    // The session this replay is on. With nothing picked, the server chooses the most recent
    // one it can load — which can differ from poll to poll if a source hiccups, so the replay
    // stays on whichever it opened with rather than switching session mid-play.
    let session = replaySession;
    // Switching view (live <-> replay) is a different data stream/clock entirely — drop
    // any buffered positions and show "loading" instead of a stale frame from the other
    // view while the first poll for the new one is in flight. Deferred to a timer callback,
    // not called synchronously in the effect body (same pattern as elsewhere in this file's
    // sibling components).
    resetFrames();
    // Every entry into a replay, or a new session, opens at lights out (see `start` below).
    stopReplayClock();
    const resetId = setTimeout(() => setState(empty), 0);

    // Poll fast only while a session is live; back off hard when idle so we're not
    // hammering the feed when nothing is happening.
    const IDLE_MS = 30_000;
    // A live poll answers in well under a second; a replay's first load can take most of the
    // route's 60 s budget fetching the archive.
    const POLL_TIMEOUT_MS = view === "replay" ? 55_000 : 20_000;
    // Guards against the visibilitychange handler below firing while a poll is already
    // in flight (very plausible — e.g. alt-tabbing during a live session) and spawning a
    // SECOND, overlapping poll on top of it. Two concurrent fetches racing to push frames
    // into the shared buffer was desyncing the interpolation and made cars visibly jump.
    let inFlight = false;

    async function poll() {
      let status: ApiResponse["status"] = "idle";
      // Tab hidden → don't hit the server (and rAF is paused anyway); re-check soon.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        if (!cancelled) timer = setTimeout(poll, 5_000);
        return;
      }
      if (inFlight) return;
      inFlight = true;
      try {
        // Incremental: ask only for frames newer than what we've buffered — keeps each
        // poll's payload/parse tiny so it never steals an animation frame. Attach the
        // visitor's own token (if they've saved one) as a header — never a query param —
        // so it never lands in a URL/log; read fresh from localStorage every poll so
        // saving/removing it in another tab takes effect on the next tick.
        const myToken = getStoredVisitorToken();
        const t0Param = view === "replay" && replayT0 ? `&t0=${replayT0}` : "";
        // A replay asks for the data its own clock needs: from `start` (lights out) the first
        // time, then up to the clock plus a lead. The lead covers the 20 s the map interpolates
        // over and the ground covered before the next poll lands, which grows with the speed.
        const sessionParam = view === "replay" && session ? `&session=${encodeURIComponent(session.path)}&year=${session.year}` : "";
        const posParam =
          view !== "replay"
            ? ""
            : replayActive()
              ? `&pos=${Math.floor(replayNow() + 20_000 + (F1_LIVE.pollMs * 1.5 * Math.max(1, replayRate())))}`
              : "&start=1";
        // Once the map has real frames, ask for trackStatus/formationLap/currentLap/rows as of
        // the SAME instant the dots are currently rendering (the playback clock, ~20s behind
        // the freshest frame) — not "now" — so a flag/lap change never shows up before the
        // dots have actually reached that moment. Frames themselves stay on the fresh `since`
        // window regardless, so the buffer keeps enough lead room to interpolate smoothly.
        const pt = getPlaybackT();
        const asOfParam = pt > 0 ? `&asOf=${Math.floor(pt)}` : "";
        const epochAtRequest = framesEpoch();
        // Bounded: a request that stalls is abandoned, and the error path below releases the
        // in-flight guard and schedules the next poll — rather than one hung request holding
        // the guard and stopping every poll after it.
        const res = await fetch(`/api/f1live?since=${newestFrameT()}&view=${view}${t0Param}${sessionParam}${posParam}${asOfParam}`, {
          cache: "no-store",
          headers: myToken ? { "X-F1-Token": myToken } : undefined,
          signal: AbortSignal.any([aborter.signal, AbortSignal.timeout(POLL_TIMEOUT_MS)]),
        });
        const data = (await res.json()) as ApiResponse;
        if (cancelled) return;
        // A seek landed while this was in flight: what came back is for the old position, and
        // pushing it would put stale frames in the fresh buffer. Fetch for the new one instead.
        if (framesEpoch() !== epochAtRequest) {
          inFlight = false;
          timer = setTimeout(poll, 0);
          return;
        }
        status = data.status;
        if (data.status === "idle" || data.status === "error") {
          setState((s) => ({
            ...s,
            status: data.status,
            tokenIssue: data.tokenIssue ?? null,
            ownerTokenConfigured: data.ownerTokenConfigured ?? false,
            scheduledLive: data.scheduledLive ?? null,
            archiveLocked: data.archiveLocked ?? false,
            replayLiveBlocked: data.replayLiveBlocked ?? false,
          }));
        } else {
          // Feed the map's animation buffer directly — NOT through React state — so the
          // heavy position payload never triggers a re-render or stalls the 60fps loop.
          pushFrames(data.frames);
          pushTel(data.telFrames);
          // Table/tyre data is non-urgent: let React yield to the map animation.
          // A replay's clock starts at lights out as soon as the timeline is known.
          if (view === "replay" && data.replayInfo) {
            session ??= { path: data.replayInfo.path, year: data.replayInfo.year };
            if (!replayActive()) setReplayClock(data.replayInfo.anchorMs, 1);
          }
          shown = data;
          shownEpoch = epochAtRequest;
          boardDue = [...(data.ahead ?? [])];
          sectorsDue = [...(data.sectorEvents ?? [])].sort((a, b) => a.t - b.t);
          const at = Date.now();
          const next = toState(data);
          startTransition(() =>
            setState((prev) => ({ ...next, replayInfo: data.replayInfo ?? prev.replayInfo, updatedAt: at, reconnecting: false, epoch: epochAtRequest })),
          );
        }
      } catch {
        // A failed or timed-out poll while a session is on screen keeps the last good board
        // and says it's reconnecting; it used to drop the whole section to the idle card. The
        // next poll is scheduled below either way.
        if (!cancelled) setState((s) => (s.status === "live" ? { ...s, reconnecting: true } : { ...s, status: "error" }));
      }
      inFlight = false;
      if (!cancelled) {
        timer = setTimeout(poll, status === "live" ? F1_LIVE.pollMs : IDLE_MS);
      }
    }

    poll();
    // A page left open for hours (waiting for a session to start) gets its background-tab
    // timers throttled hard by the browser — the 30s idle re-poll can end up firing far later
    // than scheduled, so returning to the tab could sit on stale "idle" state well past when a
    // session actually went live, until something forced a fresh check. Force one immediately
    // on refocus instead of waiting for whatever the (possibly delayed) scheduled timer does —
    // same pattern `usePolling.ts` already uses correctly for Race Control/live status.
    const onVisible = () => {
      if (document.visibilityState !== "hidden" && !inFlight) {
        clearTimeout(timer);
        poll();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    // A seek moves the replay clock to data the buffer doesn't have: fetch it now, not on the
    // next timer. (Pausing and changing speed land here too; one extra poll is harmless.)
    const unsubClock = subscribeReplayClock(() => {
      if (view === "replay" && !inFlight && replayActive()) {
        clearTimeout(timer);
        poll();
      }
    });
    return () => {
      cancelled = true;
      clearInterval(dueTimer);
      unsubClock();
      aborter.abort();
      clearTimeout(timer);
      clearTimeout(resetId);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // The session is compared by value: a new object for the same pick mustn't reset the replay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, replayT0, replaySession?.path, replaySession?.year]);

  return state;
}
