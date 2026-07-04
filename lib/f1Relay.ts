/**
 * Relay to F1's official live-timing feed (SignalR Core), authenticated with the
 * viewer's own F1 TV subscription token (F1_TV_TOKEN). Server-only.
 *
 * STATELESS by design so it runs on serverless (Vercel free): each call opens a
 * short-lived connection, `Subscribe` returns the FULL current state, then it closes.
 * A tiny module cache (2s) dedupes bursts on a warm instance, and a best-effort
 * frames buffer builds the track outline over successive polls when the instance
 * stays warm. Exposes state in the shape the dashboard already consumes.
 */
import "server-only";
import * as signalR from "@microsoft/signalr";
import WsImpl from "ws";
import zlib from "zlib";
import { parseLapTime } from "./f1feed";

const g = globalThis as unknown as { WebSocket?: unknown };
if (typeof g.WebSocket === "undefined") g.WebSocket = WsImpl;

const HUB = "https://livetiming.formula1.com/signalrcore";
const TOPICS = ["DriverList", "TimingData", "TimingAppData", "Position.z", "SessionInfo", "SessionStatus"];
const ENDED = new Set(["finished", "finalised", "ends"]);
const MAX_FRAMES = 500;

type Dict = Record<string, unknown>;
interface RawDriver {
  RacingNumber?: string;
  Tla?: string;
  FullName?: string;
  TeamName?: string;
  TeamColour?: string;
}
interface PosFrame {
  cars: Record<string, [number, number]>;
}
interface Raw {
  timing: Record<string, Dict>;
  app: Record<string, Dict>;
  drivers: Record<string, RawDriver>;
  sessionInfo: {
    Key?: number;
    Type?: string;
    Name?: string;
    ArchiveStatus?: { Status?: string };
    Meeting?: { Name?: string; Location?: string; Circuit?: { ShortName?: string; Key?: number } };
  } | null;
  sessionStatus: { Status?: string } | null;
  frames: PosFrame[]; // latest snapshot's frames (for car dots)
}

/* --------------------------------- helpers -------------------------------- */
function decodeZ(payload: string): { Position?: { Entries: Record<string, { X: number; Y: number }> }[] } {
  return JSON.parse(zlib.inflateRawSync(Buffer.from(payload, "base64")).toString("utf8"));
}

function framesFromZ(payload: string): PosFrame[] {
  const out: PosFrame[] = [];
  try {
    for (const f of decodeZ(payload).Position ?? []) {
      const cars: Record<string, [number, number]> = {};
      for (const [n, p] of Object.entries(f.Entries)) if (p.X || p.Y) cars[n] = [p.X, p.Y];
      if (Object.keys(cars).length) out.push({ cars });
    }
  } catch {}
  return out;
}

/** Build fresh state from a `Subscribe` snapshot (which is already fully merged). */
function buildRaw(snap: Record<string, unknown>): Raw {
  const raw: Raw = { timing: {}, app: {}, drivers: {}, sessionInfo: null, sessionStatus: null, frames: [] };
  for (const [k, v] of Object.entries((snap.DriverList as Dict) ?? {})) {
    if (/^\d+$/.test(k)) raw.drivers[k] = v as RawDriver;
  }
  raw.sessionInfo = (snap.SessionInfo as Raw["sessionInfo"]) ?? null;
  raw.sessionStatus = (snap.SessionStatus as Raw["sessionStatus"]) ?? null;
  for (const [n, u] of Object.entries((snap.TimingData as { Lines?: Record<string, Dict> })?.Lines ?? {})) {
    raw.timing[n] = u;
  }
  for (const [n, u] of Object.entries((snap.TimingAppData as { Lines?: Record<string, Dict> })?.Lines ?? {})) {
    raw.app[n] = u;
  }
  if (snap["Position.z"]) raw.frames = framesFromZ(snap["Position.z"] as string);
  return raw;
}

async function connectAndSubscribe(token: string): Promise<Record<string, unknown>> {
  const conn = new signalR.HubConnectionBuilder()
    .withUrl(HUB, {
      accessTokenFactory: () => token,
      transport: signalR.HttpTransportType.WebSockets,
      headers: { "User-Agent": "BestHTTP" },
    })
    .build();
  await conn.start();
  try {
    return (await conn.invoke("Subscribe", TOPICS)) as Record<string, unknown>;
  } finally {
    conn.stop().catch(() => {});
  }
}

/* ------------------------------ module cache ------------------------------ */
let cache: { at: number; raw: Raw } | null = null;
let framesBuffer: PosFrame[] = [];
let lastKey: number | undefined;

async function getRaw(): Promise<Raw | null> {
  const token = process.env.F1_TV_TOKEN?.trim();
  if (!token) return null;
  if (cache && Date.now() - cache.at < 2000) return cache.raw;

  try {
    const raw = buildRaw(await connectAndSubscribe(token));

    // Track-outline buffer: reset on a new session, accumulate while warm.
    const key = raw.sessionInfo?.Key;
    if (key !== lastKey) {
      framesBuffer = [];
      lastKey = key;
    }
    if (raw.frames.length) {
      framesBuffer.push(...raw.frames);
      if (framesBuffer.length > MAX_FRAMES) framesBuffer = framesBuffer.slice(-MAX_FRAMES);
    }

    cache = { at: Date.now(), raw };
    return raw;
  } catch {
    return cache?.raw ?? null;
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
  tyre_laps: number; // laps on the current tyre
}
export interface F1LiveState {
  mode: "race" | "quali" | "practice";
  session: { location: string; session_name: string };
  circuitKey?: number;
  drivers: F1LiveDriver[];
  order: number[];
  rows: Record<number, F1LiveRow>;
  cars: { driver_number: number; x: number; y: number }[];
  trace: { x: number; y: number }[];
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

/** Current (latest) stint → compound + laps done on that tyre. */
function currentStint(raw: Raw, numStr: string): { compound: string; laps: number } {
  const st = raw.app[numStr]?.Stints as unknown;
  let stint: { Compound?: string; TotalLaps?: number } | undefined;
  if (Array.isArray(st) && st.length) {
    stint = st[st.length - 1] as { Compound?: string; TotalLaps?: number };
  } else if (st && typeof st === "object") {
    const ks = Object.keys(st as Dict).map(Number).sort((a, b) => a - b);
    if (ks.length) stint = (st as Dict)[ks[ks.length - 1]] as { Compound?: string; TotalLaps?: number };
  }
  return { compound: stint?.Compound ?? "UNKNOWN", laps: Number(stint?.TotalLaps ?? 0) };
}

function sessionName(raw: Raw): string {
  const m = raw.sessionInfo?.Meeting;
  return `${m?.Name ?? ""} · ${raw.sessionInfo?.Name ?? ""}`.replace(/^ · /, "");
}

function classify(raw: Raw) {
  const nums = Object.keys(raw.timing).filter((k) => /^\d+$/.test(k) && Object.keys(raw.timing[k]).length);
  const mode = modeOf(raw.sessionInfo?.Type);
  const rows: Record<number, F1LiveRow> = {};
  for (const n of nums) {
    const t = raw.timing[n] as {
      Position?: string | number;
      Line?: number;
      GapToLeader?: string;
      IntervalToPositionAhead?: { Value?: string };
      BestLapTime?: { Value?: string };
      LastLapTime?: { Value?: string };
      NumberOfLaps?: number;
    };
    const num = +n;
    const stint = currentStint(raw, n);
    rows[num] = {
      driver_number: num,
      position: +(t.Position ?? t.Line ?? 99),
      gap_to_leader: t.GapToLeader ?? "",
      interval: t.IntervalToPositionAhead?.Value ?? "",
      best: parseLapTime(t.BestLapTime?.Value),
      last: parseLapTime(t.LastLapTime?.Value),
      laps: +(t.NumberOfLaps ?? 0),
      compound: stint.compound,
      tyre_laps: stint.laps,
    };
  }
  const order = nums
    .map(Number)
    .sort((a, b) => (mode === "race" ? rows[a].position - rows[b].position : (rows[a].best ?? Infinity) - (rows[b].best ?? Infinity)));
  return { nums, mode, rows, order };
}

export async function getRelayState(): Promise<F1LiveState | null> {
  const raw = await getRaw();
  if (!raw || !raw.sessionInfo) return null;

  // Only show while the session is actually GREEN (cars running). This skips the
  // pre-session build-up ("just people talking" = Inactive) and the post-session
  // period (Finished/Finalised/Ends). Red-flag ("Aborted") still counts as live.
  const status = (raw.sessionStatus?.Status ?? "").toLowerCase();
  const ended = raw.sessionInfo.ArchiveStatus?.Status === "Complete" || ENDED.has(status);
  const active = status === "started" || status === "aborted";
  if (ended || (raw.sessionStatus != null && !active)) return null;

  const { nums, mode, rows, order } = classify(raw);
  if (!nums.length) return null;

  const drivers: F1LiveDriver[] = Object.entries(raw.drivers).map(([k, d]) => ({
    driver_number: +k,
    name_acronym: d.Tla ?? String(k),
    team_colour: d.TeamColour ?? "",
    team_name: d.TeamName ?? "",
    full_name: d.FullName ?? "",
  }));

  const latest = raw.frames[raw.frames.length - 1];
  const cars = latest
    ? Object.entries(latest.cars).map(([n, [x, y]]) => ({ driver_number: +n, x, y }))
    : [];

  const leader = order[0];
  const trace: { x: number; y: number }[] = [];
  for (const f of framesBuffer) {
    const p = f.cars[String(leader)];
    if (p) trace.push({ x: p[0], y: p[1] });
  }

  return {
    mode,
    session: { location: raw.sessionInfo.Meeting?.Location ?? raw.sessionInfo.Meeting?.Circuit?.ShortName ?? "F1", session_name: sessionName(raw) },
    circuitKey: raw.sessionInfo.Meeting?.Circuit?.Key,
    drivers,
    order,
    rows,
    cars,
    trace,
  };
}

export async function getRelayResults(): Promise<SessionResult | null> {
  const raw = await getRaw();
  if (!raw || !raw.sessionInfo) return null;
  const { nums, mode, rows, order } = classify(raw);
  if (!nums.length) return null;

  const complete =
    raw.sessionInfo.ArchiveStatus?.Status === "Complete" ||
    ENDED.has((raw.sessionStatus?.Status ?? "").toLowerCase());

  return {
    session_name: sessionName(raw),
    mode,
    complete,
    top: order.map((n) => ({
      pos: rows[n].position,
      tla: raw.drivers[n]?.Tla ?? String(n),
      team_colour: raw.drivers[n]?.TeamColour ?? "",
      best: rows[n].best,
      gap: rows[n].gap_to_leader,
    })),
  };
}
