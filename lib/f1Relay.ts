/**
 * PERSISTENT relay to F1's official live-timing feed (SignalR Core), authenticated
 * with the viewer's own F1 TV token (F1_TV_TOKEN). Server-only.
 *
 * Holds ONE long-lived connection and continuously buffers the dense ~3.3 Hz
 * Position.z stream (timestamped). The client plays that buffer back on a fixed
 * delay and interpolates between the real GPS points → smooth, F1-TV-style motion
 * that follows the actual track (no prediction, no corner-cutting).
 *
 * (Needs a long-running process — great locally / on a persistent host. On stateless
 * serverless the connection can't persist, so motion there degrades to snapshots.)
 */
import "server-only";
import * as signalR from "@microsoft/signalr";
import WsImpl from "ws";
import zlib from "zlib";
import { parseLapTime } from "./f1feed";

const g = globalThis as unknown as { WebSocket?: unknown };
if (typeof g.WebSocket === "undefined") g.WebSocket = WsImpl;

const HUB = "https://livetiming.formula1.com/signalrcore";
const TOPICS = ["DriverList", "TimingData", "TimingAppData", "Position.z", "SessionInfo", "SessionStatus", "ChampionshipPrediction"];
const ENDED = new Set(["finished", "finalised", "ends"]);
const BUFFER_MS = 45_000; // keep ~45s of position frames (covers a 20s playback delay)

type Dict = Record<string, unknown>;
interface RawDriver {
  RacingNumber?: string;
  Tla?: string;
  FullName?: string;
  TeamName?: string;
  TeamColour?: string;
}
export interface PosFrame {
  t: number; // epoch ms
  c: Record<string, [number, number]>; // driver_number → [x, y]
}

/* ------------------------------ module state ------------------------------ */
let conn: signalR.HubConnection | null = null;
let starting: Promise<void> | null = null;
let lastRefresh = 0;

let timing: Record<string, Dict> = {};
let app: Record<string, Dict> = {};
let drivers: Record<string, RawDriver> = {};
let sessionInfo: {
  Key?: number;
  Type?: string;
  Name?: string;
  StartDate?: string;
  GmtOffset?: string;
  ArchiveStatus?: { Status?: string };
  Meeting?: { Name?: string; Number?: number; Location?: string; Circuit?: { ShortName?: string; Key?: number } };
} | null = null;
let sessionStatus: { Status?: string } | null = null;
let frameBuffer: PosFrame[] = [];
// Live championship projection — PERSISTS across sessions (not reset by resetOnNewSession),
// so post-race points survive after the feed clears the topic, until Jolpica catches up.
let championship: {
  Drivers?: Record<string, { PredictedPoints?: number }>;
  Teams?: Record<string, { TeamName?: string; PredictedPoints?: number }>;
} | null = null;

function resetOnNewSession(info: NonNullable<typeof sessionInfo>) {
  if (sessionInfo?.Key && info?.Key && info.Key !== sessionInfo.Key) {
    timing = {};
    app = {};
    drivers = {};
    frameBuffer = [];
    sessionStatus = null;
  }
  sessionInfo = info;
}

/* --------------------------------- helpers -------------------------------- */
function deepMerge(target: Dict, src: Dict) {
  for (const [k, v] of Object.entries(src)) {
    const cur = target[k];
    if (v && typeof v === "object" && !Array.isArray(v) && cur && typeof cur === "object" && !Array.isArray(cur)) {
      deepMerge(cur as Dict, v as Dict);
    } else {
      target[k] = v;
    }
  }
}

function decodeZ(payload: string): { Position?: { Timestamp: string; Entries: Record<string, { X: number; Y: number }> }[] } {
  return JSON.parse(zlib.inflateRawSync(Buffer.from(payload, "base64")).toString("utf8"));
}

function pushFrames(payload: string) {
  try {
    for (const f of decodeZ(payload).Position ?? []) {
      const t = Date.parse(f.Timestamp);
      if (!Number.isFinite(t)) continue;
      const c: Record<string, [number, number]> = {};
      for (const [n, p] of Object.entries(f.Entries)) if (p.X || p.Y) c[n] = [p.X, p.Y];
      if (Object.keys(c).length) frameBuffer.push({ t, c });
    }
    frameBuffer.sort((a, b) => a.t - b.t);
    const cutoff = (frameBuffer.at(-1)?.t ?? 0) - BUFFER_MS;
    if (frameBuffer.length > 40) frameBuffer = frameBuffer.filter((f) => f.t >= cutoff);
  } catch {}
}

function offsetMs(gmt?: string): number {
  const m = gmt?.match(/(-?\d{1,2}):(\d{2}):(\d{2})/);
  if (!m) return 0;
  const sign = m[1].startsWith("-") ? -1 : 1;
  return sign * (Math.abs(+m[1]) * 3600 + +m[2] * 60 + +m[3]) * 1000;
}

function applyFeed(topic: string, data: unknown) {
  if (!data) return;
  if (topic === "TimingData") {
    for (const [n, u] of Object.entries((data as { Lines?: Record<string, Dict> }).Lines ?? {})) deepMerge((timing[n] ??= {}), u);
  } else if (topic === "TimingAppData") {
    for (const [n, u] of Object.entries((data as { Lines?: Record<string, Dict> }).Lines ?? {})) {
      const cur = (app[n] ??= {});
      for (const [k, v] of Object.entries(u)) {
        if (k === "Stints") {
          // Normalize array/object stints to an index-keyed store and merge by index,
          // so a lap-count update never wipes the compound set at stint start.
          const store = (cur.Stints ??= {}) as Record<string, Dict>;
          const entries = Array.isArray(v)
            ? (v as unknown[]).map((s, i) => [String(i), s] as [string, unknown])
            : Object.entries(v as Dict);
          for (const [idx, s] of entries) {
            if (s && typeof s === "object") deepMerge((store[idx] ??= {}), s as Dict);
          }
        } else if (v && typeof v === "object" && !Array.isArray(v)) {
          deepMerge((cur[k] ??= {}) as Dict, v as Dict);
        } else {
          cur[k] = v;
        }
      }
    }
  } else if (topic === "DriverList") {
    for (const [k, v] of Object.entries(data as Dict)) if (/^\d+$/.test(k)) deepMerge((drivers[k] ??= {}) as unknown as Dict, v as Dict);
  } else if (topic === "SessionInfo") {
    resetOnNewSession(data as NonNullable<typeof sessionInfo>);
  } else if (topic === "SessionStatus") {
    sessionStatus = data as typeof sessionStatus;
  } else if (topic === "ChampionshipPrediction") {
    const d = data as NonNullable<typeof championship>;
    if (Object.keys(d?.Drivers ?? {}).length || Object.keys(d?.Teams ?? {}).length) {
      championship ??= {};
      if (d.Drivers) {
        championship.Drivers ??= {};
        for (const [k, v] of Object.entries(d.Drivers)) deepMerge((championship.Drivers[k] ??= {}), v as Dict);
      }
      if (d.Teams) {
        championship.Teams ??= {};
        for (const [k, v] of Object.entries(d.Teams)) deepMerge((championship.Teams[k] ??= {}), v as Dict);
      }
    }
  } else if (topic === "Position.z") {
    pushFrames(data as string);
  }
}

function applySnapshot(snap: Record<string, unknown>) {
  if (!snap) return;
  if (snap.SessionInfo) resetOnNewSession(snap.SessionInfo as NonNullable<typeof sessionInfo>);
  if (snap.SessionStatus) sessionStatus = snap.SessionStatus as typeof sessionStatus;
  if (snap.ChampionshipPrediction) applyFeed("ChampionshipPrediction", snap.ChampionshipPrediction);
  if (snap.DriverList) applyFeed("DriverList", snap.DriverList);
  if (snap.TimingData) applyFeed("TimingData", snap.TimingData);
  if (snap.TimingAppData) applyFeed("TimingAppData", snap.TimingAppData);
  if (snap["Position.z"]) pushFrames(snap["Position.z"] as string);
}

async function ensureConnection(): Promise<boolean> {
  const token = process.env.F1_TV_TOKEN?.trim();
  if (!token) return false;
  if (conn && conn.state === signalR.HubConnectionState.Connected) return true;
  if (starting) {
    await starting.catch(() => {});
    return conn?.state === signalR.HubConnectionState.Connected;
  }
  starting = (async () => {
    const c = new signalR.HubConnectionBuilder()
      .withUrl(HUB, { accessTokenFactory: () => token, transport: signalR.HttpTransportType.WebSockets, headers: { "User-Agent": "BestHTTP" } })
      .withAutomaticReconnect()
      .build();
    c.on("feed", (topic: string, data: unknown) => {
      try {
        applyFeed(topic, data);
      } catch {}
    });
    c.onreconnected(async () => {
      try {
        applySnapshot((await c.invoke("Subscribe", TOPICS)) as Record<string, unknown>);
      } catch {}
    });
    await c.start();
    conn = c;
    applySnapshot((await c.invoke("Subscribe", TOPICS)) as Record<string, unknown>);
    lastRefresh = Date.now();
  })();
  try {
    await starting;
    return true;
  } catch {
    conn = null;
    return false;
  } finally {
    starting = null;
  }
}

/**
 * Re-Subscribe periodically to refresh SessionInfo/SessionStatus. The continuous
 * feed can miss the end-of-session transition, leaving state stale ("still live");
 * this pulls a fresh snapshot every few seconds so pre/post-session is caught.
 */
async function refreshIfStale() {
  if (conn?.state === signalR.HubConnectionState.Connected && Date.now() - lastRefresh > 4000) {
    lastRefresh = Date.now();
    try {
      applySnapshot((await conn.invoke("Subscribe", TOPICS)) as Record<string, unknown>);
    } catch {}
  }
}

/* ------------------------------- derivation ------------------------------- */
export interface F1LiveDriver {
  driver_number: number;
  name_acronym: string;
  team_colour: string;
  team_name: string;
  full_name: string;
}
export interface F1LiveRow {
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
export interface F1LiveState {
  mode: "race" | "quali" | "practice";
  session: { location: string; session_name: string };
  circuitKey?: number;
  drivers: F1LiveDriver[];
  order: number[];
  rows: Record<number, F1LiveRow>;
  frames: PosFrame[]; // recent window for smooth client playback
}
export interface SessionResult {
  session_name: string;
  mode: "race" | "quali" | "practice";
  complete: boolean;
  top: { pos: number; tla: string; team_colour: string; best: number | null; gap: string }[];
}

function modeOf(type?: string): F1LiveState["mode"] {
  const t = (type ?? "").toLowerCase();
  if (t.includes("qual")) return "quali";
  if (t.includes("practice")) return "practice";
  return "race";
}

function currentStint(numStr: string): { compound: string; laps: number } {
  const st = app[numStr]?.Stints as unknown;
  let stint: { Compound?: string; TotalLaps?: number } | undefined;
  if (Array.isArray(st) && st.length) stint = st[st.length - 1] as { Compound?: string; TotalLaps?: number };
  else if (st && typeof st === "object") {
    const ks = Object.keys(st as Dict).map(Number).sort((a, b) => a - b);
    if (ks.length) stint = (st as Dict)[ks[ks.length - 1]] as { Compound?: string; TotalLaps?: number };
  }
  return { compound: stint?.Compound ?? "UNKNOWN", laps: Number(stint?.TotalLaps ?? 0) };
}

function sessionName(): string {
  const m = sessionInfo?.Meeting;
  return `${m?.Name ?? ""} · ${sessionInfo?.Name ?? ""}`.replace(/^ · /, "");
}

/**
 * Is a session on track right now? Live from 1 min before its scheduled start until
 * it ends — so Q1/Q2/Q3 (and any red-flag) breaks stay "live", but pre-show and
 * post-show are skipped. Falls back to SessionStatus if no scheduled start is known.
 */
function liveNow(): boolean {
  if (!sessionInfo) return false;
  const status = (sessionStatus?.Status ?? "").toLowerCase();
  if (sessionInfo.ArchiveStatus?.Status === "Complete" || ENDED.has(status)) return false;
  if (sessionInfo.StartDate) {
    const startMs = Date.parse(sessionInfo.StartDate + "Z") - offsetMs(sessionInfo.GmtOffset);
    return Number.isFinite(startMs) && Date.now() >= startMs - 60_000;
  }
  return status === "started" || status === "aborted";
}

function classify() {
  const nums = Object.keys(timing).filter((k) => /^\d+$/.test(k) && Object.keys(timing[k]).length);
  const mode = modeOf(sessionInfo?.Type);
  const rows: Record<number, F1LiveRow> = {};
  for (const n of nums) {
    const t = timing[n] as {
      Position?: string | number;
      Line?: number;
      GapToLeader?: string;
      IntervalToPositionAhead?: { Value?: string };
      BestLapTime?: { Value?: string };
      LastLapTime?: { Value?: string };
      NumberOfLaps?: number;
      InPit?: boolean;
    };
    const stint = currentStint(n);
    rows[+n] = {
      driver_number: +n,
      position: +(t.Position ?? t.Line ?? 99),
      gap_to_leader: t.GapToLeader ?? "",
      interval: t.IntervalToPositionAhead?.Value ?? "",
      best: parseLapTime(t.BestLapTime?.Value),
      last: parseLapTime(t.LastLapTime?.Value),
      laps: +(t.NumberOfLaps ?? 0),
      compound: stint.compound,
      tyre_laps: stint.laps,
      in_pit: Boolean(t.InPit),
    };
  }
  const order = nums.map(Number).sort((a, b) => (mode === "race" ? rows[a].position - rows[b].position : (rows[a].best ?? Infinity) - (rows[b].best ?? Infinity)));
  return { nums, mode, rows, order };
}

export async function getRelayState(): Promise<F1LiveState | null> {
  if (!(await ensureConnection())) return null;
  await refreshIfStale();
  if (!sessionInfo || !liveNow()) return null;

  const { nums, mode, rows, order } = classify();
  if (!nums.length) return null;

  const driverList: F1LiveDriver[] = Object.entries(drivers).map(([k, d]) => ({
    driver_number: +k,
    name_acronym: d.Tla ?? String(k),
    team_colour: d.TeamColour ?? "",
    team_name: d.TeamName ?? "",
    full_name: d.FullName ?? "",
  }));

  return {
    mode,
    session: { location: sessionInfo.Meeting?.Location ?? sessionInfo.Meeting?.Circuit?.ShortName ?? "F1", session_name: sessionName() },
    circuitKey: sessionInfo.Meeting?.Circuit?.Key,
    drivers: driverList,
    order,
    rows,
    frames: frameBuffer.slice(-150), // ~45s window (covers the 20s delay + jitter)
  };
}

/**
 * Live championship projection from the feed — instant updated points during/right
 * after a Sprint or Race, keyed by driver TLA and constructor name. `round` is the
 * meeting number so the client can prefer Jolpica once it has caught up.
 */
export async function getChampionship(): Promise<{
  available: boolean;
  round?: number;
  driverPoints?: Record<string, number>;
  constructorPoints?: Record<string, number>;
}> {
  if (!(await ensureConnection())) return { available: false };
  await refreshIfStale();
  if (!championship?.Drivers) return { available: false };

  const driverPoints: Record<string, number> = {};
  for (const [num, d] of Object.entries(championship.Drivers)) {
    const tla = drivers[num]?.Tla;
    if (tla && d.PredictedPoints != null) driverPoints[tla] = d.PredictedPoints;
  }
  const constructorPoints: Record<string, number> = {};
  for (const t of Object.values(championship.Teams ?? {})) {
    if (t.TeamName && t.PredictedPoints != null) constructorPoints[t.TeamName] = t.PredictedPoints;
  }
  if (!Object.keys(driverPoints).length) return { available: false };
  return { available: true, round: sessionInfo?.Meeting?.Number ?? 0, driverPoints, constructorPoints };
}

/** Lightweight "is a session live and which one" — for the hero + schedule. */
export async function getLiveStatus(): Promise<{ live: boolean; name?: string; type?: string }> {
  if (!(await ensureConnection())) return { live: false };
  await refreshIfStale();
  if (!sessionInfo) return { live: false };
  return { live: liveNow(), name: sessionName(), type: sessionInfo.Type };
}

export async function getRelayResults(): Promise<SessionResult | null> {
  if (!(await ensureConnection())) return null;
  await refreshIfStale();
  if (!sessionInfo) return null;
  const { nums, mode, rows, order } = classify();
  if (!nums.length) return null;
  const complete = sessionInfo.ArchiveStatus?.Status === "Complete" || ENDED.has((sessionStatus?.Status ?? "").toLowerCase());
  return {
    session_name: sessionName(),
    mode,
    complete,
    top: order.map((n) => ({ pos: rows[n].position, tla: drivers[n]?.Tla ?? String(n), team_colour: drivers[n]?.TeamColour ?? "", best: rows[n].best, gap: rows[n].gap_to_leader })),
  };
}
