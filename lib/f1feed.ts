/**
 * F1 free live-timing engine (server-side only).
 *
 * Reads F1's own public static feeds — no API key, no auth:
 *   https://livetiming.formula1.com/static/<sessionPath>/<Feed>.jsonStream
 *
 * Each feed line is `HH:MM:SS.mmm<payload>`; `.z` feeds are base64 + raw-deflate.
 * F1 sends incremental deltas, so we deep-merge lines up to a cutoff timestamp to
 * reconstruct state at any instant (which powers both replay and live polling).
 */
import zlib from "zlib";
import { F1_LIVE } from "./f1liveConfig";

const UA = { "User-Agent": "BestHTTP" };
const TS_LEN = 12; // "HH:MM:SS.mmm"

/* --------------------------------- parsing --------------------------------- */
function tsToMs(ts: string): number {
  const m = ts.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
  if (!m) return 0;
  return (+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000 + +m[4];
}

function decodeZ(payload: string): unknown {
  const buf = Buffer.from(payload.trim().replace(/"/g, ""), "base64");
  return JSON.parse(zlib.inflateRawSync(buf).toString("utf8"));
}

function deepMerge(target: Record<string, unknown>, src: Record<string, unknown>) {
  for (const [k, v] of Object.entries(src)) {
    const cur = target[k];
    if (v && typeof v === "object" && !Array.isArray(v) && cur && typeof cur === "object" && !Array.isArray(cur)) {
      deepMerge(cur as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      target[k] = v;
    }
  }
}

/** "1:22.358" → 82.358 ; "59.512" → 59.512 ; "" → null */
export function parseLapTime(v?: string | null): number | null {
  if (!v) return null;
  const parts = v.split(":");
  const s = parts.length === 2 ? +parts[0] * 60 + +parts[1] : +parts[0];
  return Number.isFinite(s) && s > 0 ? s : null;
}

/* --------------------------------- fetching -------------------------------- */
async function fetchText(sessionPath: string, feed: string): Promise<string> {
  const res = await fetch(`${F1_LIVE.base}/${sessionPath}${feed}`, {
    headers: UA,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`F1 feed ${feed} → ${res.status}`);
  return res.text();
}

/* ---------------------------- session resolution --------------------------- */
export interface ResolvedSession {
  path: string;
  type: string;
  name: string;
  location: string;
  live: boolean; // true only when the session is happening right now
  startWallMs?: number; // UTC ms of session start (used for the live clock)
}

interface IdxSession {
  Type: string;
  Name: string;
  Path: string;
  StartDate: string;
  EndDate: string;
  GmtOffset: string;
}
interface IdxMeeting {
  Name: string;
  Location?: string;
  Circuit?: { ShortName?: string };
  Sessions: IdxSession[];
}

function offsetMs(gmt: string): number {
  const m = gmt.match(/(-?\d{1,2}):(\d{2}):(\d{2})/);
  if (!m) return 0;
  const sign = m[1].startsWith("-") ? -1 : 1;
  return sign * (Math.abs(+m[1]) * 3600 + +m[2] * 60 + +m[3]) * 1000;
}

interface FlatSession extends ResolvedSession {
  startMs: number;
  endMs: number;
}

async function flatSessions(): Promise<FlatSession[]> {
  const res = await fetch(`${F1_LIVE.base}/${new Date().getUTCFullYear()}/Index.json`, {
    headers: UA,
    cache: "no-store",
  });
  if (!res.ok) return [];
  const idx = JSON.parse((await res.text()).replace(/^﻿/, "")) as { Meetings: IdxMeeting[] };

  const flat: FlatSession[] = [];
  for (const m of idx.Meetings) {
    const location = m.Location ?? m.Circuit?.ShortName ?? m.Name;
    for (const s of m.Sessions) {
      if (!s.Path) continue; // a scheduled session with no feed path published yet
      const off = offsetMs(s.GmtOffset);
      flat.push({
        path: s.Path,
        type: s.Type,
        name: `${m.Name} · ${s.Name}`,
        location,
        live: false,
        startMs: Date.parse(s.StartDate + "Z") - off,
        endMs: Date.parse(s.EndDate + "Z") - off,
      });
    }
  }
  return flat;
}

/** A session on track right now that also has a published feed path. */
export async function resolveLiveSession(): Promise<ResolvedSession | null> {
  if (F1_LIVE.mode === "replay") return null;
  const now = Date.now();
  const live = (await flatSessions()).find(
    (s) => now >= s.startMs - 6 * 60_000 && now <= s.endMs + 10 * 60_000,
  );
  return live ? { ...live, live: true, startWallMs: live.startMs } : null;
}

/**
 * Ordered fallback candidates (most recent past sessions, preferring the configured
 * type). The route tries them until one actually has data — so we always land on a
 * session with a real feed even if the newest one hasn't been published yet.
 */
export async function fallbackCandidates(): Promise<ResolvedSession[]> {
  if (F1_LIVE.mode === "live") return [];
  const now = Date.now();
  const past = (await flatSessions())
    .filter((s) => s.startMs <= now)
    .sort((a, b) => b.startMs - a.startMs);
  const preferred = past.filter((s) => s.type === F1_LIVE.preferType);
  const rest = past.filter((s) => s.type !== F1_LIVE.preferType);
  return [...preferred, ...rest].slice(0, 5).map((s) => ({ ...s, live: false }));
}

/* ------------------------------ session cache ------------------------------ */
interface Delta {
  ts: number;
  lines: Record<string, unknown>;
}
interface PosFrame {
  ts: number;
  cars: Record<string, [number, number]>;
}
interface RawDriver {
  RacingNumber: string;
  Tla: string;
  FullName: string;
  TeamName: string;
  TeamColour: string;
}
interface SessionCache {
  loadedAt: number;
  drivers: Record<string, RawDriver>;
  timing: Delta[];
  app: Delta[];
  frames: PosFrame[];
  durationMs: number;
}

const cache = new Map<string, SessionCache>();

function parseDeltas(text: string): Delta[] {
  const out: Delta[] = [];
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    if (!raw) continue;
    try {
      const d = JSON.parse(raw.slice(TS_LEN)) as { Lines?: Record<string, unknown> };
      out.push({ ts: tsToMs(raw.slice(0, TS_LEN)), lines: d.Lines ?? {} });
    } catch {}
  }
  return out;
}

async function load(sessionPath: string, live: boolean): Promise<SessionCache> {
  const cached = cache.get(sessionPath);
  // Completed session → static, cache forever. Live → 2s TTL so polls see fresh data.
  if (cached && (!live || Date.now() - cached.loadedAt < 2000)) return cached;

  const [driverTxt, timingTxt, appTxt, posTxt] = await Promise.all([
    fetchText(sessionPath, "DriverList.jsonStream").catch(() => ""),
    fetchText(sessionPath, "TimingData.jsonStream").catch(() => ""),
    fetchText(sessionPath, "TimingAppData.jsonStream").catch(() => ""),
    fetchText(sessionPath, "Position.z.jsonStream").catch(() => ""),
  ]);

  const drivers: Record<string, RawDriver> = {};
  for (const raw of driverTxt.replace(/^﻿/, "").split(/\r?\n/)) {
    if (!raw) continue;
    try {
      const d = JSON.parse(raw.slice(TS_LEN)) as Record<string, unknown>;
      for (const [k, v] of Object.entries(d)) {
        if (/^\d+$/.test(k)) deepMerge((drivers[k] ??= {} as RawDriver) as unknown as Record<string, unknown>, v as Record<string, unknown>);
      }
    } catch {}
  }

  const timing = parseDeltas(timingTxt);
  const app = parseDeltas(appTxt);

  const frames: PosFrame[] = [];
  for (const raw of posTxt.replace(/^﻿/, "").split(/\r?\n/)) {
    if (!raw) continue;
    try {
      const dec = decodeZ(raw.slice(TS_LEN)) as {
        Position?: { Entries: Record<string, { X: number; Y: number }> }[];
      };
      const ts = tsToMs(raw.slice(0, TS_LEN));
      for (const f of dec.Position ?? []) {
        const cars: Record<string, [number, number]> = {};
        for (const [num, p] of Object.entries(f.Entries)) {
          if (p.X || p.Y) cars[num] = [p.X, p.Y];
        }
        frames.push({ ts, cars });
      }
    } catch {}
  }

  const durationMs = Math.max(timing.at(-1)?.ts ?? 0, frames.at(-1)?.ts ?? 0);
  const entry: SessionCache = { loadedAt: Date.now(), drivers, timing, app, frames, durationMs };
  cache.set(sessionPath, entry);
  return entry;
}

export async function getSessionDuration(sessionPath: string, live: boolean): Promise<number> {
  return (await load(sessionPath, live)).durationMs;
}

/* ------------------------------ state reducer ------------------------------ */
export interface F1LiveRow {
  driver_number: number;
  position: number;
  gap_to_leader: string;
  interval: string;
  best: number | null;
  last: number | null;
  laps: number;
  compound: string;
}
export interface F1LiveDriver {
  driver_number: number;
  name_acronym: string;
  team_colour: string;
  team_name: string;
  full_name: string;
}
export interface F1LiveState {
  mode: "race" | "quali" | "practice";
  drivers: F1LiveDriver[];
  order: number[];
  rows: Record<number, F1LiveRow>;
  cars: { driver_number: number; x: number; y: number }[];
  trace: { x: number; y: number }[];
  durationMs: number;
}

function mergeUpto(deltas: Delta[], uptoMs: number): Record<string, Record<string, unknown>> {
  const state: Record<string, Record<string, unknown>> = {};
  for (const d of deltas) {
    if (d.ts > uptoMs) break;
    for (const [num, upd] of Object.entries(d.lines)) {
      deepMerge((state[num] ??= {}), upd as Record<string, unknown>);
    }
  }
  return state;
}

function mode(type: string): F1LiveState["mode"] {
  const t = type.toLowerCase();
  if (t.includes("qual")) return "quali";
  if (t.includes("practice")) return "practice";
  return "race";
}

export async function getF1LiveState(
  sessionPath: string,
  sessionType: string,
  uptoMs: number,
  live: boolean,
): Promise<F1LiveState> {
  const s = await load(sessionPath, live);
  const timing = mergeUpto(s.timing, uptoMs);
  const appState = mergeUpto(s.app, uptoMs);

  const drivers: F1LiveDriver[] = Object.values(s.drivers).map((d) => ({
    driver_number: +d.RacingNumber,
    name_acronym: d.Tla,
    team_colour: d.TeamColour,
    team_name: d.TeamName,
    full_name: d.FullName,
  }));

  const rows: Record<number, F1LiveRow> = {};
  for (const [numStr, t] of Object.entries(timing)) {
    const num = +numStr;
    const bt = t.BestLapTime as { Value?: string } | undefined;
    const lt = t.LastLapTime as { Value?: string } | undefined;
    const iv = t.IntervalToPositionAhead as { Value?: string } | undefined;
    const stints = (appState[numStr]?.Stints ?? {}) as Record<string, { Compound?: string }>;
    const keys = Object.keys(stints).map(Number).sort((a, b) => a - b);
    const compound = keys.length ? (stints[keys[keys.length - 1]]?.Compound ?? "UNKNOWN") : "UNKNOWN";

    rows[num] = {
      driver_number: num,
      position: +(t.Position ?? t.Line ?? 99),
      gap_to_leader: (t.GapToLeader as string) ?? "",
      interval: iv?.Value ?? "",
      best: parseLapTime(bt?.Value),
      last: parseLapTime(lt?.Value),
      laps: +(t.NumberOfLaps ?? 0),
      compound,
    };
  }

  const m = mode(sessionType);
  const order = Object.keys(rows)
    .map(Number)
    .sort((a, b) => {
      if (m === "race") return rows[a].position - rows[b].position;
      const ba = rows[a].best ?? Infinity;
      const bb = rows[b].best ?? Infinity;
      return ba - bb;
    });

  let latest: PosFrame | undefined;
  for (const f of s.frames) {
    if (f.ts > uptoMs) break;
    latest = f;
  }
  const cars = latest
    ? Object.entries(latest.cars).map(([num, [x, y]]) => ({ driver_number: +num, x, y }))
    : [];

  const leader = order[0];
  const traceStart = uptoMs - 110_000;
  const trace: { x: number; y: number }[] = [];
  for (const f of s.frames) {
    if (f.ts > uptoMs) break;
    if (f.ts < traceStart) continue;
    const p = f.cars[String(leader)];
    if (p) trace.push({ x: p[0], y: p[1] });
  }

  return { mode: m, drivers, order, rows, cars, trace, durationMs: s.durationMs };
}
