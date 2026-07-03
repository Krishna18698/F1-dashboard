/**
 * Real-time relay to F1's official live-timing feed (SignalR Core),
 * authenticated with the viewer's own F1 TV subscription token (F1_TV_TOKEN).
 *
 * Server-only. Holds ONE long-lived connection as a module singleton, keeps the
 * merged live state in memory, and exposes it in the same shape the dashboard uses.
 * This is the same feed F1 TV / MultiViewer use — free beyond the subscription.
 */
import "server-only";
import * as signalR from "@microsoft/signalr";
import WsImpl from "ws";
import zlib from "zlib";
import { parseLapTime } from "./f1feed";

// SignalR needs a global WebSocket. Node 22+ has one; polyfill with `ws` otherwise.
const g = globalThis as unknown as { WebSocket?: unknown };
if (typeof g.WebSocket === "undefined") g.WebSocket = WsImpl;

const HUB = "https://livetiming.formula1.com/signalrcore";
const TOPICS = ["Heartbeat", "DriverList", "TimingData", "TimingAppData", "Position.z", "SessionInfo", "SessionStatus", "TrackStatus"];
// SessionStatus values that mean the session is over → dashboard should minimize.
const ENDED = new Set(["finished", "finalised", "ends"]);
const MAX_FRAMES = 500; // rolling car-position history for the track outline

interface RawDriver {
  RacingNumber?: string;
  Tla?: string;
  FullName?: string;
  TeamName?: string;
  TeamColour?: string;
}
type Dict = Record<string, unknown>;

/* ------------------------------ module state ------------------------------ */
let conn: signalR.HubConnection | null = null;
let starting: Promise<void> | null = null;
let lastRefresh = 0;

let timing: Record<string, Dict> = {};
let app: Record<string, Dict> = {};
let driverMap: Record<string, RawDriver> = {};
let sessionInfo: {
  Key?: number;
  Type?: string;
  Name?: string;
  ArchiveStatus?: { Status?: string };
  Meeting?: { Name?: string; Location?: string; Circuit?: { ShortName?: string } };
} | null = null;
let sessionStatus: { Status?: string } | null = null;
let frames: { cars: Record<string, [number, number]> }[] = [];

/** Reset all per-session state when the feed switches to a new session. */
function setSessionInfo(info: NonNullable<typeof sessionInfo>) {
  if (sessionInfo?.Key && info?.Key && info.Key !== sessionInfo.Key) {
    timing = {};
    app = {};
    driverMap = {};
    frames = [];
    sessionStatus = null;
  }
  sessionInfo = info;
}

/* ------------------------------- helpers --------------------------------- */
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

function decodeZ(payload: string): { Position?: { Entries: Record<string, { X: number; Y: number }> }[] } {
  return JSON.parse(zlib.inflateRawSync(Buffer.from(payload, "base64")).toString("utf8"));
}

function applyPositionZ(payload: string) {
  try {
    const dec = decodeZ(payload);
    for (const f of dec.Position ?? []) {
      const cars: Record<string, [number, number]> = {};
      for (const [n, p] of Object.entries(f.Entries)) if (p.X || p.Y) cars[n] = [p.X, p.Y];
      if (Object.keys(cars).length) frames.push({ cars });
    }
    if (frames.length > MAX_FRAMES) frames = frames.slice(-MAX_FRAMES);
  } catch {}
}

function applyFeed(topic: string, data: unknown) {
  if (!data) return;
  if (topic === "TimingData") {
    const lines = (data as { Lines?: Record<string, Dict> }).Lines ?? {};
    for (const [n, u] of Object.entries(lines)) deepMerge((timing[n] ??= {}), u);
  } else if (topic === "TimingAppData") {
    const lines = (data as { Lines?: Record<string, Dict> }).Lines ?? {};
    for (const [n, u] of Object.entries(lines)) deepMerge((app[n] ??= {}), u);
  } else if (topic === "DriverList") {
    for (const [k, v] of Object.entries(data as Dict)) {
      if (/^\d+$/.test(k)) deepMerge((driverMap[k] ??= {}) as unknown as Dict, v as Dict);
    }
  } else if (topic === "SessionInfo") {
    setSessionInfo(data as NonNullable<typeof sessionInfo>);
  } else if (topic === "SessionStatus") {
    sessionStatus = data as typeof sessionStatus;
  } else if (topic === "Position.z") {
    applyPositionZ(data as string);
  }
}

function applySnapshot(snap: Record<string, unknown>) {
  if (!snap) return;
  // SessionInfo first (it may reset state on a new session), then the rest.
  if (snap.SessionInfo) setSessionInfo(snap.SessionInfo as NonNullable<typeof sessionInfo>);
  if (snap.SessionStatus) sessionStatus = snap.SessionStatus as typeof sessionStatus;
  if (snap.DriverList) applyFeed("DriverList", snap.DriverList);
  if (snap.TimingData) applyFeed("TimingData", snap.TimingData);
  if (snap.TimingAppData) applyFeed("TimingAppData", snap.TimingAppData);
  if (snap["Position.z"]) applyPositionZ(snap["Position.z"] as string);
}

/* ---------------------------- connection mgmt ---------------------------- */
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
      .withUrl(HUB, {
        accessTokenFactory: () => token,
        transport: signalR.HttpTransportType.WebSockets,
        headers: { "User-Agent": "BestHTTP" },
      })
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

/** Re-Subscribe periodically so state stays fresh even when deltas are quiet. */
async function maybeRefresh() {
  if (conn?.state === signalR.HubConnectionState.Connected && Date.now() - lastRefresh > 2500) {
    lastRefresh = Date.now();
    try {
      applySnapshot((await conn.invoke("Subscribe", TOPICS)) as Record<string, unknown>);
    } catch {}
  }
}

/* ------------------------------ derive state ----------------------------- */
export interface RelayState {
  mode: "race" | "quali" | "practice";
  session: { location: string; session_name: string };
  drivers: { driver_number: number; name_acronym: string; team_colour: string; team_name: string; full_name: string }[];
  order: number[];
  rows: Record<number, { driver_number: number; position: number; gap_to_leader: string; interval: string; best: number | null; last: number | null; laps: number; compound: string }>;
  cars: { driver_number: number; x: number; y: number }[];
  trace: { x: number; y: number }[];
}

function modeOf(type?: string): RelayState["mode"] {
  const t = (type ?? "").toLowerCase();
  if (t.includes("qual")) return "quali";
  if (t.includes("practice")) return "practice";
  return "race";
}

function compoundOf(numStr: string): string {
  const st = app[numStr]?.Stints as unknown;
  if (Array.isArray(st) && st.length) return (st[st.length - 1] as { Compound?: string })?.Compound ?? "UNKNOWN";
  if (st && typeof st === "object") {
    const ks = Object.keys(st as Dict).map(Number).sort((a, b) => a - b);
    if (ks.length) return ((st as Dict)[ks[ks.length - 1]] as { Compound?: string })?.Compound ?? "UNKNOWN";
  }
  return "UNKNOWN";
}

export async function getRelayState(): Promise<RelayState | null> {
  if (!(await ensureConnection())) return null;
  await maybeRefresh();

  // Minimize once the session has ended (feed keeps final data until the next one).
  const ended =
    sessionInfo?.ArchiveStatus?.Status === "Complete" ||
    ENDED.has((sessionStatus?.Status ?? "").toLowerCase());
  if (ended) return null;

  const nums = Object.keys(timing).filter((k) => /^\d+$/.test(k) && Object.keys(timing[k]).length);
  if (!nums.length || !sessionInfo) return null;

  const driverList = Object.entries(driverMap)
    .filter(([k]) => /^\d+$/.test(k))
    .map(([k, d]) => ({
      driver_number: +k,
      name_acronym: d.Tla ?? String(k),
      team_colour: d.TeamColour ?? "",
      team_name: d.TeamName ?? "",
      full_name: d.FullName ?? "",
    }));

  const rows: RelayState["rows"] = {};
  for (const n of nums) {
    const t = timing[n] as {
      Position?: string | number;
      Line?: number;
      GapToLeader?: string;
      IntervalToPositionAhead?: { Value?: string };
      BestLapTime?: { Value?: string };
      LastLapTime?: { Value?: string };
      NumberOfLaps?: number;
    };
    const num = +n;
    rows[num] = {
      driver_number: num,
      position: +(t.Position ?? t.Line ?? 99),
      gap_to_leader: t.GapToLeader ?? "",
      interval: t.IntervalToPositionAhead?.Value ?? "",
      best: parseLapTime(t.BestLapTime?.Value),
      last: parseLapTime(t.LastLapTime?.Value),
      laps: +(t.NumberOfLaps ?? 0),
      compound: compoundOf(n),
    };
  }

  const mode = modeOf(sessionInfo.Type);
  const order = nums
    .map(Number)
    .sort((a, b) => {
      if (mode === "race") return rows[a].position - rows[b].position;
      return (rows[a].best ?? Infinity) - (rows[b].best ?? Infinity);
    });

  const lastFrame = frames[frames.length - 1];
  const cars = lastFrame
    ? Object.entries(lastFrame.cars).map(([n, [x, y]]) => ({ driver_number: +n, x, y }))
    : [];

  const leader = order[0];
  const trace: { x: number; y: number }[] = [];
  for (const f of frames) {
    const p = f.cars[String(leader)];
    if (p) trace.push({ x: p[0], y: p[1] });
  }

  const m = sessionInfo.Meeting;
  return {
    mode,
    session: {
      location: m?.Location ?? m?.Circuit?.ShortName ?? m?.Name ?? "F1",
      session_name: `${m?.Name ?? ""} · ${sessionInfo.Name ?? ""}`.replace(/^ · /, ""),
    },
    drivers: driverList,
    order,
    rows,
    cars,
    trace,
  };
}

/* ------------------------------ session result ---------------------------- */
export interface SessionResult {
  session_name: string;
  mode: "race" | "quali" | "practice";
  complete: boolean;
  top: { pos: number; tla: string; team_colour: string; best: number | null; gap: string }[];
}

/**
 * Top-5 classification of the current OR most-recently-completed session.
 * Unlike getRelayState this ignores the ended-guard, so finished sessions
 * (Sprint Qualifying, Sprint, Qualifying, Race …) still surface their result.
 */
export async function getRelayResults(): Promise<SessionResult | null> {
  if (!(await ensureConnection())) return null;
  await maybeRefresh();

  const nums = Object.keys(timing).filter((k) => /^\d+$/.test(k) && Object.keys(timing[k]).length);
  if (!nums.length || !sessionInfo) return null;

  const mode = modeOf(sessionInfo.Type);
  const arr = nums.map((n) => {
    const t = timing[n] as {
      Position?: string | number;
      Line?: number;
      GapToLeader?: string;
      BestLapTime?: { Value?: string };
    };
    return {
      pos: +(t.Position ?? t.Line ?? 99),
      tla: driverMap[n]?.Tla ?? String(n),
      team_colour: driverMap[n]?.TeamColour ?? "",
      best: parseLapTime(t.BestLapTime?.Value),
      gap: t.GapToLeader ?? "",
    };
  });
  arr.sort((a, b) => (mode === "race" ? a.pos - b.pos : (a.best ?? Infinity) - (b.best ?? Infinity)));

  const complete =
    sessionInfo?.ArchiveStatus?.Status === "Complete" ||
    ENDED.has((sessionStatus?.Status ?? "").toLowerCase());

  return {
    session_name: `${sessionInfo.Meeting?.Name ?? ""} · ${sessionInfo.Name ?? ""}`.replace(/^ · /, ""),
    mode,
    complete,
    top: arr, // full classification — the hero ticker rolls through all of them
  };
}
