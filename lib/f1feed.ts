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
// Standard FIA qualifying segment durations.
const QUALI_DURATION_MS: Record<number, number> = { 1: 18 * 60_000, 2: 15 * 60_000, 3: 12 * 60_000 };

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
    } else if (v && typeof v === "object") {
      // First time this key appears on target: clone rather than alias `v`, which is a
      // piece of a cached, reused Delta object (mergeUpto runs on the same cached deltas
      // on every request) — assigning by reference let later merges mutate that cached
      // source object permanently, corrupting things like stint first-seen tracking.
      target[k] = structuredClone(v);
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

export async function flatSessions(): Promise<FlatSession[]> {
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
export interface RcMessage {
  Utc?: string;
  Category?: string;
  Message?: string;
  Flag?: string;
  Scope?: string;
  Sector?: number;
  Status?: string;
  Mode?: string;
  RacingNumber?: string;
  Lap?: number;
}
interface SessionCache {
  loadedAt: number;
  drivers: Record<string, RawDriver>;
  timing: Delta[];
  app: Delta[];
  lap: { ts: number; data: Record<string, unknown> }[];
  track: { ts: number; status: string }[];
  rc: { ts: number; idx: string; msg: RcMessage }[]; // race control messages, flattened
  qp: { ts: number; part: number }[]; // QualifyingPart transitions (1=Q1, 2=Q2, 3=Q3)
  car: { ts: number; raw: string }[]; // CarData.z lines, decoded lazily (window per request)
  posOffset: number | null; // absolute Utc → session-relative ms (shared by Position + CarData)
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

  const [driverTxt, timingTxt, appTxt, posTxt, lapTxt, trackTxt, carTxt, rcTxt, qpTxt] = await Promise.all([
    fetchText(sessionPath, "DriverList.jsonStream").catch(() => ""),
    fetchText(sessionPath, "TimingData.jsonStream").catch(() => ""),
    fetchText(sessionPath, "TimingAppData.jsonStream").catch(() => ""),
    fetchText(sessionPath, "Position.z.jsonStream").catch(() => ""),
    fetchText(sessionPath, "LapCount.jsonStream").catch(() => ""),
    fetchText(sessionPath, "TrackStatus.jsonStream").catch(() => ""),
    fetchText(sessionPath, "CarData.z.jsonStream").catch(() => ""),
    fetchText(sessionPath, "RaceControlMessages.jsonStream").catch(() => ""),
    fetchText(sessionPath, "SessionData.jsonStream").catch(() => ""),
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

  // LapCount stream: "HH:MM:SS.mmm{CurrentLap,TotalLaps}" (flat, not keyed by driver).
  const lap: { ts: number; data: Record<string, unknown> }[] = [];
  for (const raw of lapTxt.replace(/^﻿/, "").split(/\r?\n/)) {
    if (!raw) continue;
    try {
      lap.push({ ts: tsToMs(raw.slice(0, TS_LEN)), data: JSON.parse(raw.slice(TS_LEN)) as Record<string, unknown> });
    } catch {}
  }

  // TrackStatus stream: sparse "{Status, Message}" lines (green/yellow/SC/red…).
  const track: { ts: number; status: string }[] = [];
  for (const raw of trackTxt.replace(/^﻿/, "").split(/\r?\n/)) {
    if (!raw) continue;
    try {
      const d = JSON.parse(raw.slice(TS_LEN)) as { Status?: string };
      if (d.Status != null) track.push({ ts: tsToMs(raw.slice(0, TS_LEN)), status: String(d.Status) });
    } catch {}
  }

  // SessionData: sparse "Series" index-keyed deltas carrying QualifyingPart (1=Q1,2=Q2,3=Q3),
  // present only in Qualifying sessions.
  const qp: { ts: number; part: number }[] = [];
  for (const raw of qpTxt.replace(/^﻿/, "").split(/\r?\n/)) {
    if (!raw) continue;
    try {
      const d = JSON.parse(raw.slice(TS_LEN)) as { Series?: Record<string, { QualifyingPart?: number }> };
      for (const v of Object.values(d.Series ?? {})) {
        if (v.QualifyingPart != null) qp.push({ ts: tsToMs(raw.slice(0, TS_LEN)), part: v.QualifyingPart });
      }
    } catch {}
  }

  // RaceControlMessages: the first line's "Messages" is a full-snapshot ARRAY; every line
  // after that is an index-keyed OBJECT delta (same shape the token relay parses). Flatten
  // to a (ts, idx, msg) list so any instant can be reconstructed by merging up to it.
  const rc: { ts: number; idx: string; msg: RcMessage }[] = [];
  for (const raw of rcTxt.replace(/^﻿/, "").split(/\r?\n/)) {
    if (!raw) continue;
    try {
      const ts = tsToMs(raw.slice(0, TS_LEN));
      const d = JSON.parse(raw.slice(TS_LEN)) as { Messages?: unknown };
      if (Array.isArray(d.Messages)) {
        d.Messages.forEach((msg, i) => rc.push({ ts, idx: String(i), msg: msg as RcMessage }));
      } else if (d.Messages && typeof d.Messages === "object") {
        for (const [idx, msg] of Object.entries(d.Messages as Record<string, unknown>)) {
          rc.push({ ts, idx, msg: msg as RcMessage });
        }
      }
    } catch {}
  }

  // CarData.z: thousands of compressed lines — keep them RAW (ts + payload) and decode only
  // the one bracketing the requested instant, so load stays fast and memory small.
  const car: { ts: number; raw: string }[] = [];
  for (const raw of carTxt.replace(/^﻿/, "").split(/\r?\n/)) {
    if (!raw) continue;
    const ts = tsToMs(raw.slice(0, TS_LEN));
    if (Number.isFinite(ts)) car.push({ ts, raw: raw.slice(TS_LEN) });
  }

  const frames: PosFrame[] = [];
  let posOffset: number | null = null; // absolute Timestamp → session-relative timeline
  for (const raw of posTxt.replace(/^﻿/, "").split(/\r?\n/)) {
    if (!raw) continue;
    try {
      const dec = decodeZ(raw.slice(TS_LEN)) as {
        Position?: { Timestamp?: string; Entries: Record<string, { X: number; Y: number }> }[];
      };
      const lineTs = tsToMs(raw.slice(0, TS_LEN));
      for (const f of dec.Position ?? []) {
        // Each line batches several ~300ms GPS samples. Use each sample's OWN Timestamp
        // (mapped onto the session-relative timeline via a fixed offset) — collapsing
        // them all onto the line's timestamp quantised motion to ~1s steps, which made
        // playback sit still then leap ("slow + skips the track").
        let ts = lineTs;
        const abs = f.Timestamp ? Date.parse(f.Timestamp) : NaN;
        if (Number.isFinite(abs)) {
          if (posOffset === null) posOffset = abs - lineTs;
          ts = abs - posOffset;
        }
        const cars: Record<string, [number, number]> = {};
        for (const [num, p] of Object.entries(f.Entries)) {
          if (p.X || p.Y) cars[num] = [p.X, p.Y];
        }
        frames.push({ ts, cars });
      }
    } catch {}
  }
  frames.sort((a, b) => a.ts - b.ts);

  const durationMs = Math.max(timing.at(-1)?.ts ?? 0, frames.at(-1)?.ts ?? 0);
  const entry: SessionCache = { loadedAt: Date.now(), drivers, timing, app, lap, track, rc, qp, car, posOffset, frames, durationMs };
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
  tyre_laps: number;
  in_pit: boolean;
  retired: boolean;
  knocked_out: boolean;
  grid: number;
  stints: { compound: string; laps: number; age: number; isNew: boolean; segment: number | null }[];
  weekendTyresLeft: { compound: string; left: number }[];
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
  frames: { t: number; c: Record<string, [number, number]> }[];
  totalLaps: number;
  currentLap: number;
  fastestLap: { driver_number: number; tla: string; time: string; lap: number } | null;
  trackStatus: string | null;
  telFrames: { t: number; c: Record<string, [number, number, number, number]> }[];
  qualifyingPart: number | null;
  qualifyingRemainingMs: number | null;
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

/** Which qualifying segment (1/2/3) was active at a given instant, from the full transition
 *  history. Falls back to Q1 if the instant predates the first recorded transition. */
function segmentAtTs(qp: { ts: number; part: number }[], ts: number): number | null {
  if (!qp.length) return null;
  let seg = qp[0].part;
  for (const p of qp) {
    if (p.ts <= ts) seg = p.part;
    else break;
  }
  return seg;
}

/** For each driver+stint-index, the ts of the delta that FIRST introduced it — lets each
 *  stint be attributed to the qualifying segment it began in. */
function stintFirstSeenTimes(app: Delta[], uptoMs: number): Record<string, Record<string, number>> {
  const seen: Record<string, Record<string, number>> = {};
  for (const d of app) {
    if (d.ts > uptoMs) break;
    for (const [num, upd] of Object.entries(d.lines)) {
      const stints = (upd as { Stints?: unknown })?.Stints;
      if (!stints) continue;
      const idxs = Array.isArray(stints) ? stints.map((_, i) => String(i)) : Object.keys(stints as object);
      const store = (seen[num] ??= {});
      for (const idx of idxs) if (store[idx] === undefined) store[idx] = d.ts;
    }
  }
  return seen;
}

function mode(type: string): F1LiveState["mode"] {
  const t = type.toLowerCase();
  if (t.includes("qual")) return "quali";
  if (t.includes("practice")) return "practice";
  return "race";
}

/** See the identical helper in f1Relay.ts for why this clamp is needed. */
function clampStintsToLaps<T extends { laps: number }>(stints: T[], totalLaps: number): T[] {
  const over = stints.reduce((a, s) => a + s.laps, 0) - totalLaps;
  if (over <= 0 || !stints.length) return stints;
  const out = stints.map((s) => ({ ...s }));
  let remaining = over;
  for (let i = out.length - 1; i >= 0 && remaining > 0; i--) {
    const cut = Math.min(out[i].laps, remaining);
    out[i].laps -= cut;
    remaining -= cut;
  }
  return out;
}

// Standard dry-tyre weekend allocation (13 sets) for a normal (non-alternative-tyre) event —
// the live feed has no topic for the FIA's actual per-round nomination (a separate published
// document, and the exact split can vary slightly by round), so this is the common default.
export const WEEKEND_ALLOCATION: Record<string, number> = { SOFT: 8, MEDIUM: 3, HARD: 2 };
export const DRY_COMPOUNDS = ["SOFT", "MEDIUM", "HARD"] as const;

/** How many sets of each compound have been freshly mounted (feed's `New` flag) so far,
 *  per driver — from a single session's merged TimingAppData state. */
function countNewSetsByDriver(
  appState: Record<string, Record<string, unknown>>,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [numStr, upd] of Object.entries(appState)) {
    const stints = (upd.Stints ?? {}) as Record<string, { Compound?: string; New?: string | boolean }>;
    for (const st of Object.values(stints)) {
      if (String(st.New) !== "true") continue;
      const compound = String(st.Compound ?? "").toUpperCase();
      if (!DRY_COMPOUNDS.includes(compound as (typeof DRY_COMPOUNDS)[number])) continue;
      const bucket = (out[numStr] ??= {});
      bucket[compound] = (bucket[compound] ?? 0) + 1;
    }
  }
  return out;
}

function addCounts(target: Record<string, Record<string, number>>, src: Record<string, Record<string, number>>) {
  for (const [num, byCompound] of Object.entries(src)) {
    const t = (target[num] ??= {});
    for (const [c, n] of Object.entries(byCompound)) t[c] = (t[c] ?? 0) + n;
  }
}

// Completed sessions are immutable — cache their new-set tally forever once computed, so
// repeated polls of a later session (e.g. Qualifying) don't re-fetch+re-scan FP1/FP2/FP3
// on every request.
const priorSessionNewSetCache = new Map<string, Record<string, Record<string, number>>>();

export async function newSetCountsForCompletedSession(sessionPath: string): Promise<Record<string, Record<string, number>>> {
  const cached = priorSessionNewSetCache.get(sessionPath);
  if (cached) return cached;
  const s = await load(sessionPath, false);
  const counts = countNewSetsByDriver(mergeUpto(s.app, Number.MAX_SAFE_INTEGER));
  priorSessionNewSetCache.set(sessionPath, counts);
  return counts;
}

/** Practice/Qualifying sessions of the same event (same meeting folder) that happened at or
 *  before this one — the sessions whose tyre usage counts against the same weekend allocation. */
async function weekendPriorSessions(sessionPath: string): Promise<string[]> {
  const prefix = sessionPath.split("/").slice(0, 2).join("/") + "/";
  const all = await flatSessions();
  const mine = all.find((s) => s.path === sessionPath);
  if (!mine) return [];
  return all
    .filter(
      (s) =>
        s.path !== sessionPath &&
        s.path.startsWith(prefix) &&
        s.startMs <= mine.startMs &&
        /practice|qualifying/i.test(s.type),
    )
    .map((s) => s.path);
}

/** Sets remaining (of the weekend's assumed dry-tyre allocation) per driver, per compound —
 *  weekend total usage (prior sessions, cached, + this session up to `uptoMs`) subtracted
 *  from WEEKEND_ALLOCATION. Always returns all three dry compounds, even at 0 used. */
async function weekendTyresLeft(
  sessionPath: string,
  currentAppState: Record<string, Record<string, unknown>>,
): Promise<Record<string, { compound: string; left: number }[]>> {
  const total: Record<string, Record<string, number>> = {};
  const priors = await weekendPriorSessions(sessionPath).catch(() => []);
  for (const p of priors) {
    try {
      addCounts(total, await newSetCountsForCompletedSession(p));
    } catch {}
  }
  addCounts(total, countNewSetsByDriver(currentAppState));

  const out: Record<string, { compound: string; left: number }[]> = {};
  for (const numStr of Object.keys(currentAppState).concat(Object.keys(total))) {
    if (out[numStr]) continue;
    const used = total[numStr] ?? {};
    out[numStr] = DRY_COMPOUNDS.map((c) => ({ compound: c, left: Math.max(0, WEEKEND_ALLOCATION[c] - (used[c] ?? 0)) }));
  }
  return out;
}

/**
 * Same weekend-allocation math as `weekendTyresLeft`, for callers that don't have a static
 * session path for the CURRENT session (the token relay runs the live one over its own
 * WebSocket, not a static file) — matched by meeting name instead, against past FP/Quali
 * sessions of the same event that DO have a published static feed. `liveSessionUsed` is the
 * caller's own tally of fresh sets mounted so far in its live session.
 */
export async function weekendTyresLeftForMeeting(
  meetingName: string,
  beforeStartMs: number,
  liveSessionUsed: Record<string, Record<string, number>>,
): Promise<Record<string, { compound: string; left: number }[]>> {
  const total: Record<string, Record<string, number>> = {};
  const all = await flatSessions().catch(() => []);
  const priors = all.filter(
    (s) => s.name.startsWith(`${meetingName} · `) && s.startMs <= beforeStartMs && /practice|qualifying/i.test(s.type),
  );
  for (const p of priors) {
    try {
      addCounts(total, await newSetCountsForCompletedSession(p.path));
    } catch {}
  }
  addCounts(total, liveSessionUsed);

  const out: Record<string, { compound: string; left: number }[]> = {};
  for (const numStr of Object.keys(total)) {
    const used = total[numStr];
    out[numStr] = DRY_COMPOUNDS.map((c) => ({ compound: c, left: Math.max(0, WEEKEND_ALLOCATION[c] - (used[c] ?? 0)) }));
  }
  return out;
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
  const stintFirstSeenAt = stintFirstSeenTimes(s.app, uptoMs);
  const weekendMap = await weekendTyresLeft(sessionPath, appState).catch(
    () => ({}) as Record<string, { compound: string; left: number }[]>,
  );

  const drivers: F1LiveDriver[] = Object.values(s.drivers).map((d) => ({
    driver_number: +d.RacingNumber,
    name_acronym: d.Tla,
    team_colour: d.TeamColour,
    team_name: d.TeamName,
    full_name: d.FullName,
  }));

  const rows: Record<number, F1LiveRow> = {};
  let fastestLap: F1LiveState["fastestLap"] = null;
  let fastestMs = Infinity;
  for (const [numStr, t] of Object.entries(timing)) {
    const num = +numStr;
    const bt = t.BestLapTime as { Value?: string; Lap?: number } | undefined;
    const lt = t.LastLapTime as { Value?: string } | undefined;
    const iv = t.IntervalToPositionAhead as { Value?: string } | undefined;
    const stintsRaw = (appState[numStr]?.Stints ?? {}) as Record<
      string,
      { Compound?: string; TotalLaps?: number; StartLaps?: number; New?: string | boolean }
    >;
    const keys = Object.keys(stintsRaw).map(Number).sort((a, b) => a - b);
    const cur = keys.length ? stintsRaw[keys[keys.length - 1]] : undefined;
    const stintsRawList = keys
      .map((k) => {
        const st = stintsRaw[k];
        const total = Number(st.TotalLaps ?? 0);
        const start = Number(st.StartLaps ?? 0);
        const compound = String(st.Compound ?? "").toUpperCase() || "UNKNOWN";
        // "New" arrives as the STRING "true"/"false", not a real boolean.
        const isNew = String(st.New) === "true";
        const firstSeen = stintFirstSeenAt[numStr]?.[String(k)];
        const segment = firstSeen != null ? segmentAtTs(s.qp, firstSeen) : null;
        return { compound, laps: Math.max(0, total - start), age: total, isNew, segment };
      })
      .filter((st) => st.compound !== "UNKNOWN" || st.laps > 0);

    const best = parseLapTime(bt?.Value);
    const numberOfLaps = +(t.NumberOfLaps ?? 0);
    // Tyre-age (TimingAppData) and lap-count (TimingData) are independently-updating feed
    // topics — around Safety Car / Red Flag periods they drift, so stint widths can sum to
    // more than the driver's actual completed laps (bars overshooting the shared lap axis).
    // Clamp to the real lap count, trimming the CURRENT (most recent) stint first.
    const stints = clampStintsToLaps(stintsRawList, numberOfLaps);
    rows[num] = {
      driver_number: num,
      position: +(t.Position ?? t.Line ?? 99),
      gap_to_leader: (t.GapToLeader as string) ?? "",
      interval: iv?.Value ?? "",
      best,
      last: parseLapTime(lt?.Value),
      laps: numberOfLaps,
      compound: cur?.Compound ?? "UNKNOWN",
      tyre_laps: Number(cur?.TotalLaps ?? 0),
      in_pit: Boolean(t.InPit),
      retired: Boolean(t.Retired || t.Stopped),
      knocked_out: Boolean(t.KnockedOut),
      grid: Number((appState[numStr]?.GridPos as string | number) ?? 0),
      stints,
      weekendTyresLeft: weekendMap[numStr] ?? DRY_COMPOUNDS.map((c) => ({ compound: c, left: WEEKEND_ALLOCATION[c] })),
    };
    if (best != null && best < fastestMs && bt?.Value) {
      fastestMs = best;
      fastestLap = { driver_number: num, tla: s.drivers[numStr]?.Tla ?? numStr, time: bt.Value, lap: Number(bt.Lap ?? 0) };
    }
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
  // Position buffer for smooth client playback (same shape the token relay emits).
  const FRAME_WINDOW = 45_000;
  const outFrames: { t: number; c: Record<string, [number, number]> }[] = [];
  for (const f of s.frames) {
    if (f.ts > uptoMs) break;
    if (f.ts >= uptoMs - FRAME_WINDOW) outFrames.push({ t: f.ts, c: f.cars });
    if (f.ts >= traceStart) {
      const p = f.cars[String(leader)];
      if (p) trace.push({ x: p[0], y: p[1] });
    }
  }

  // Lap counter up to now (races) — for the tyre-tracker lap axis.
  let currentLap = 0;
  let totalLaps = 0;
  for (const l of s.lap) {
    if (l.ts > uptoMs) break;
    if (l.data.CurrentLap != null) currentLap = Number(l.data.CurrentLap);
    if (l.data.TotalLaps != null) totalLaps = Number(l.data.TotalLaps);
  }

  // Track status at this instant (yellow/SC/red map tint).
  let trackStatus: string | null = null;
  for (const t of s.track) {
    if (t.ts > uptoMs) break;
    trackStatus = t.status;
  }

  // Which qualifying segment is live at this instant (1=Q1, 2=Q2, 3=Q3), and when it began
  // (for the live countdown — standard FIA durations: Q1 18min, Q2 15min, Q3 12min).
  let qualifyingPart: number | null = null;
  let qualifyingPartStartTs: number | null = null;
  for (const p of s.qp) {
    if (p.ts > uptoMs) break;
    qualifyingPart = p.part;
    qualifyingPartStartTs = p.ts;
  }
  const qualifyingRemainingMs =
    qualifyingPart && qualifyingPartStartTs != null
      ? Math.max(0, QUALI_DURATION_MS[qualifyingPart] - (uptoMs - qualifyingPartStartTs))
      : null;

  // Telemetry window [upto − 45s, upto]: decode only the CarData lines in the window
  // (lines are ~1.3s batches → ~35 tiny inflates) and keep each sample's OWN Utc
  // (mapped via posOffset onto the session clock) so the client can play it back on the
  // same delayed clock as the dots — continuous ~4Hz updates, in sync with the map.
  const telFrames: F1LiveState["telFrames"] = [];
  if (s.car.length) {
    // Binary-search the first line that could contribute to the window (lines batch ~1.3s
    // of samples stamped up to ~2s after the line ts, so start a little early).
    const startTs = uptoMs - FRAME_WINDOW - 3000;
    let lo = 0, hi = s.car.length - 1, first = s.car.length;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (s.car[mid].ts >= startTs) { first = mid; hi = mid - 1; } else lo = mid + 1;
    }
    for (let i = first; i < s.car.length && s.car[i].ts <= uptoMs; i++) {
      try {
        const dec = decodeZ(s.car[i].raw) as {
          Entries?: { Utc?: string; Cars?: Record<string, { Channels?: Record<string, number> }> }[];
        };
        for (const e of dec.Entries ?? []) {
          const abs = e.Utc ? Date.parse(e.Utc) : NaN;
          const t = Number.isFinite(abs) && s.posOffset !== null ? abs - s.posOffset : s.car[i].ts;
          if (t > uptoMs || t < uptoMs - FRAME_WINDOW || !e.Cars) continue;
          const c: Record<string, [number, number, number, number]> = {};
          for (const [num, car] of Object.entries(e.Cars)) {
            const ch = car.Channels;
            if (ch) c[num] = [ch["0"] ?? 0, ch["2"] ?? 0, ch["3"] ?? 0, ch["4"] ?? 0];
          }
          if (Object.keys(c).length) telFrames.push({ t, c });
        }
      } catch {}
    }
    telFrames.sort((a, b) => a.t - b.t);
  }

  return {
    mode: m,
    drivers,
    order,
    rows,
    cars,
    trace,
    frames: outFrames,
    totalLaps: m === "race" ? totalLaps : 0,
    currentLap,
    fastestLap,
    trackStatus,
    telFrames,
    qualifyingPart,
    qualifyingRemainingMs,
    durationMs: s.durationMs,
  };
}

/** Most-recent completed RACE's top finishers from the free feed (no token needed). */
export async function getStaticResults(): Promise<{
  session_name: string;
  mode: "race";
  complete: boolean;
  endedAtMs: number;
  top: { pos: number; tla: string; team_colour: string; best: number | null; gap: string }[];
} | null> {
  const now = Date.now();
  const race = (await flatSessions())
    .filter((s) => /race/i.test(s.type) && !/sprint/i.test(s.type) && s.endMs <= now)
    .sort((a, b) => b.endMs - a.endMs)[0];
  if (!race) return null;
  const st = await getF1LiveState(race.path, race.type, Number.MAX_SAFE_INTEGER, false);
  if (!st.order.length) return null;
  const byNum = new Map(st.drivers.map((d) => [d.driver_number, d]));
  const top = st.order.map((n) => {
    const r = st.rows[n];
    const d = byNum.get(n);
    return { pos: r.position, tla: d?.name_acronym ?? String(n), team_colour: d?.team_colour ?? "", best: r.best, gap: r.gap_to_leader };
  });
  return { session_name: race.name, mode: "race", complete: true, endedAtMs: race.endMs, top };
}

/**
 * Resolves the (session path, instant, live-ness) the free-feed live panel is currently
 * showing — the exact same test-replay → live → fallback branching `/api/f1live` uses —
 * so `/api/racecontrol` can serve messages for that SAME session without a token.
 */
export async function resolveFreeInstant(): Promise<{ path: string; uptoMs: number; live: boolean } | null> {
  if (F1_LIVE.replay.enabled) {
    const r = F1_LIVE.replay;
    const dur = await getSessionDuration(r.sessionPath, false);
    const anchor = Math.floor(dur * r.anchorFrac);
    const span = Math.max(1, dur - anchor);
    const upto = anchor + ((Date.now() - r.restartedAtMs) % span);
    return { path: r.sessionPath, uptoMs: upto, live: false };
  }

  const live = await resolveLiveSession();
  if (live && live.startWallMs != null) {
    return { path: live.path, uptoMs: Date.now() - live.startWallMs, live: true };
  }

  for (const c of await fallbackCandidates()) {
    const dur = await getSessionDuration(c.path, false);
    if (!dur) continue;
    const anchor = Math.floor(dur * F1_LIVE.replayAnchorFrac);
    const span = Math.max(1, dur - anchor);
    const upto = anchor + (Date.now() % span);
    return { path: c.path, uptoMs: upto, live: false };
  }
  return null;
}

/** Race control messages + track status at a given instant, from the free feed. */
export async function getStaticRaceControl(
  sessionPath: string,
  uptoMs: number,
  live: boolean,
): Promise<{
  available: boolean;
  trackStatus?: { Status?: string; Message?: string } | null;
  messages?: RcMessage[];
}> {
  const s = await load(sessionPath, live);

  const byIdx: Record<string, RcMessage> = {};
  for (const r of s.rc) {
    if (r.ts > uptoMs) break;
    byIdx[r.idx] = { ...(byIdx[r.idx] ?? {}), ...r.msg };
  }
  const messages = Object.values(byIdx)
    .filter((m) => m.Message)
    .sort((a, b) => (b.Utc ?? "").localeCompare(a.Utc ?? ""))
    .slice(0, 150);

  let trackStatus: { Status?: string; Message?: string } | null = null;
  for (const t of s.track) {
    if (t.ts > uptoMs) break;
    trackStatus = { Status: t.status };
  }

  if (!messages.length) return { available: false };
  return { available: true, trackStatus, messages };
}
