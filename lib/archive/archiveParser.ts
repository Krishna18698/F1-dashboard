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
import { postEndLiveMs, PRE_START_LIVE_MS, QUALI_DURATION_MS, SPRINT_QUALI_DURATION_MS } from "../sessionWindows";
import zlib from "zlib";
import { F1_LIVE } from "../live/liveConfig";

const UA = { "User-Agent": "BestHTTP" };
const TS_LEN = 12; // "HH:MM:SS.mmm"
// Standard FIA qualifying segment durations.
// See the matching pair in liveSocket.ts — Sprint Qualifying's segments are shorter than a
// Saturday qualifying's, and both carry Type "Qualifying", so the session path is what
// distinguishes them here (".../2026-08-21_Sprint_Qualifying/").

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

/** True for {"0":…,"3":…} — F1's shorthand for "these indices of an array changed". */
function isIndexPatch(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const keys = Object.keys(v as Record<string, unknown>);
  return keys.length > 0 && keys.every((k) => /^\d+$/.test(k));
}

function deepMerge(target: Record<string, unknown>, src: Record<string, unknown>) {
  for (const [k, v] of Object.entries(src)) {
    const cur = target[k];
    // An index-keyed patch against a stored ARRAY must merge into it, not replace it. F1
    // sends Sectors/Segments as arrays in the snapshot and as {"3": {...}} in deltas; the
    // old fall-through replaced the whole array with just the changed member, wiping
    // mini-sectors 0-2 — which is why bars appeared blank mid-lap and flashed back when the
    // next full snapshot arrived.
    if (Array.isArray(cur) && isIndexPatch(v)) {
      for (const [ik, iv] of Object.entries(v)) {
        const i = Number(ik);
        const slot = (cur as unknown[])[i];
        if (iv && typeof iv === "object" && !Array.isArray(iv) && slot && typeof slot === "object" && !Array.isArray(slot)) {
          deepMerge(slot as Record<string, unknown>, iv as Record<string, unknown>);
        } else {
          (cur as unknown[])[i] = iv && typeof iv === "object" ? structuredClone(iv) : iv;
        }
      }
      continue;
    }
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
  circuitKey?: number; // MultiViewer circuit id, for the track-map outline
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
  Circuit?: { ShortName?: string; Key?: number };
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
        circuitKey: m.Circuit?.Key,
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
    (s) => now >= s.startMs - PRE_START_LIVE_MS && now <= s.endMs + postEndLiveMs(s.type, s.name),
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
    .filter((s) => !F1_LIVE.replayExcludePaths.some((bad) => s.path.includes(bad)))
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
  /** SessionInfo.GmtOffset ("02:00:00"), for race control's local wall-clock announcements.
   *  Null when the archive doesn't carry SessionInfo — the restart countdown is then omitted
   *  rather than guessed. */
  gmtOffset: string | null;
  qp: { ts: number; part: number }[]; // QualifyingPart transitions (1=Q1, 2=Q2, 3=Q3)
  sessionStartedTs: number | null; // SessionStatus:"Started" — lights-out/race-start instant
  /** Every SessionStatus transition with its session-relative timestamp. Qualifying emits a
   *  Started+Finished pair PER SEGMENT, which is what the between-segments state needs. */
  statusHist: { ts: number; status: string }[];
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

  const [driverTxt, timingTxt, appTxt, posTxt, lapTxt, trackTxt, carTxt, rcTxt, qpTxt, infoTxt] = await Promise.all([
    fetchText(sessionPath, "DriverList.jsonStream").catch(() => ""),
    fetchText(sessionPath, "TimingData.jsonStream").catch(() => ""),
    fetchText(sessionPath, "TimingAppData.jsonStream").catch(() => ""),
    fetchText(sessionPath, "Position.z.jsonStream").catch(() => ""),
    fetchText(sessionPath, "LapCount.jsonStream").catch(() => ""),
    fetchText(sessionPath, "TrackStatus.jsonStream").catch(() => ""),
    fetchText(sessionPath, "CarData.z.jsonStream").catch(() => ""),
    fetchText(sessionPath, "RaceControlMessages.jsonStream").catch(() => ""),
    fetchText(sessionPath, "SessionData.jsonStream").catch(() => ""),
    fetchText(sessionPath, "SessionInfo.json").catch(() => ""),
  ]);
  let gmtOffset: string | null = null;
  try {
    gmtOffset = (JSON.parse(infoTxt.replace(/^\ufeff/, "")) as { GmtOffset?: string }).GmtOffset ?? null;
  } catch {}

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
  // present only in Qualifying sessions. Also carries "StatusSeries" transitions, including
  // SessionStatus:"Started" — F1's own explicit signal for lights-out/race-start, a far more
  // reliable "the race has actually begun" marker than inferring it from position/lap data.
  const qp: { ts: number; part: number }[] = [];
  const statusHist: { ts: number; status: string }[] = [];
  let sessionStartedTs: number | null = null;
  for (const raw of qpTxt.replace(/^﻿/, "").split(/\r?\n/)) {
    if (!raw) continue;
    try {
      const ts = tsToMs(raw.slice(0, TS_LEN));
      const d = JSON.parse(raw.slice(TS_LEN)) as {
        Series?: Record<string, { QualifyingPart?: number }>;
        StatusSeries?: Record<string, { SessionStatus?: string }> | { SessionStatus?: string }[];
      };
      for (const v of Object.values(d.Series ?? {})) {
        if (v.QualifyingPart != null) qp.push({ ts, part: v.QualifyingPart });
      }
      const statusEntries = Array.isArray(d.StatusSeries) ? d.StatusSeries : Object.values(d.StatusSeries ?? {});
      for (const st of statusEntries) {
        if (st.SessionStatus) statusHist.push({ ts, status: st.SessionStatus });
        if (st.SessionStatus === "Started" && sessionStartedTs === null) sessionStartedTs = ts;
      }
    } catch {}
  }

  // RaceControlMessages: the first line's "Messages" is a full-snapshot ARRAY; every line
  // after that is an index-keyed OBJECT delta (same shape the token socket parses). Flatten
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
  const entry: SessionCache = {
    loadedAt: Date.now(),
    drivers,
    timing,
    app,
    lap,
    track,
    rc,
    qp,
    gmtOffset,
    sessionStartedTs,
    statusHist,
    car,
    posOffset,
    frames,
    durationMs,
  };
  cache.set(sessionPath, entry);
  return entry;
}

export async function getSessionDuration(sessionPath: string, live: boolean): Promise<number> {
  return (await load(sessionPath, live)).durationMs;
}

// Formation laps run ~2-5 min; F1's feed has no explicit "formation lap starts" marker, so
// back off a fixed buffer from the real SessionStatus:"Started" instant to include it.
const FORMATION_LAP_BUFFER_MS = 3 * 60_000;

/** "Lights out" anchor for replay. Literal ts=0 is the start of pre-race broadcast coverage
 *  (garage/grid, cars going out one at a time on reconnaissance laps) — using it made replay
 *  open on an empty track for 10+ minutes before the race, let alone the formation lap,
 *  began. SessionStatus:"Started" (from SessionData) is F1's own explicit race-start signal;
 *  back off a fixed buffer from it to also cover the formation lap. Falls back to the first
 *  real position sample if a session predates/lacks that topic. */
export async function getReplayAnchorMs(sessionPath: string, live: boolean): Promise<number> {
  const s = await load(sessionPath, live);
  if (s.sessionStartedTs != null) return Math.max(0, s.sessionStartedTs - FORMATION_LAP_BUFFER_MS);
  for (const f of s.frames) {
    if (Object.keys(f.cars).length > 0) return f.ts;
  }
  return 0;
}

interface SectorRaw {
  Value?: string;
  PreviousValue?: string;
  OverallFastest?: boolean;
  PersonalFastest?: boolean;
  Segments?: unknown;
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
  /** S1/S2/S3 with F1's purple/green flags — same shape the socket emits, so the UI is
   *  identical whether a session is live or being replayed from the archive. */
  sectors: { value: string; overallFastest: boolean; personalFastest: boolean; segments: number[] }[];
  /** I1/I2/FL/ST speed traps — from TimingData, so ungated and available without a token. */
  speeds: Record<string, { value: string; overallFastest: boolean; personalFastest: boolean }>;
  /** This driver's BEST S1/S2/S3 of the session, in seconds. The live sector values only
   *  describe the current lap, so a "where is the lap being lost" comparison needs the best
   *  each driver has managed, tracked separately. */
  bestSectors: (number | null)[];
}
/** A mini-sector that F1 has already reported but the car dots haven't reached yet. */
export interface SegmentEvent {
  t: number; // session-relative ms, on the same clock as the position frames
  n: number; // driver number
  s: number; // sector index 0-2
  i: number; // mini-sector index
  c: number; // status code
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
  /** F1 SessionStatus at this instant: "Started" | "Aborted" (red flag) | "Finished" | ... */
  sessionStatus: string | null;
  /** Announced restart instant while suspended, as an epoch the client can count down to.
   *  Replay runs on a virtual clock, so this is rebased onto wall time. */
  suspendedRestartMs: number | null;
  telFrames: { t: number; c: Record<string, [number, number, number, number]> }[];
  qualifyingPart: number | null;
  qualifyingRemainingMs: number | null;
  qualifyingSegmentEnded?: boolean;
  nextQualifyingSegmentInMs?: number | null;
  formationLap: boolean;
  durationMs: number;
  segmentEvents?: SegmentEvent[];
  /** Line crossings ahead of the dots — lets the card blank on time. */
  lapResets?: { t: number; n: number }[];
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

/** See the identical helper in liveSocket.ts for why this clamp is needed. */
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
 * session path for the CURRENT session (the token socket runs the live one over its own
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
  // Everything EXCEPT frames/telFrames (rows, trackStatus, currentLap, formationLap, ...)
  // is computed as of `infoUptoMs` instead of `uptoMs` when given. Frames must stay on the
  // raw/fresh `uptoMs` so the client's buffer keeps enough lead room to interpolate smoothly;
  // the on-screen dots then render ~20s behind that via TrackMap's own playback delay. Every
  // OTHER displayed value (a flag tint, the lap counter, gaps) needs to reflect that SAME
  // delayed instant, or it visibly "knows" things before the dots have caught up to them.
  infoUptoMs: number = uptoMs,
): Promise<F1LiveState> {
  const s = await load(sessionPath, live);
  const timing = mergeUpto(s.timing, infoUptoMs);
  // A sector's Value survives the line — F1 only overwrites it when the sector is next
  // completed. Merged state alone therefore can't say which lap a time belongs to. Walk the
  // deltas once more and note WHEN each sector's Value was written, and when the driver last
  // had their mini-sectors blanked (the line crossing). A value older than the reset is last
  // lap's, and must not be shown however complete the mini-sectors look.
  const valueSetAt: Record<string, number[]> = {};
  const lapResetAt: Record<string, number> = {};
  const bestSectorOf: Record<string, (number | null)[]> = {};
  for (const dlt of s.timing) {
    if (dlt.ts > infoUptoMs) break;
    for (const [numStr, upd] of Object.entries(dlt.lines)) {
      const secs = (upd as { Sectors?: unknown }).Sectors;
      if (!secs || typeof secs !== "object") continue;
      let zeros = 0;
      for (const [sk, sv] of Object.entries(secs as Record<string, { Value?: string; Segments?: unknown }>)) {
        const si = Number(sk);
        if (!Number.isNaN(si) && sv?.Value) {
          (valueSetAt[numStr] ??= [])[si] = dlt.ts;
          const secs = parseLapTime(sv.Value);
          if (secs != null) {
            const cur = (bestSectorOf[numStr] ??= [null, null, null])[si];
            if (cur == null || secs < cur) bestSectorOf[numStr][si] = secs;
          }
        }
        const segs = sv?.Segments;
        if (segs && typeof segs === "object") {
          for (const gv of Object.values(segs as Record<string, { Status?: number }>)) {
            if (Number(gv?.Status ?? -1) === 0) zeros++;
          }
        }
      }
      if (zeros >= 12) lapResetAt[numStr] = dlt.ts;
    }
  }
  const appState = mergeUpto(s.app, infoUptoMs);
  const stintFirstSeenAt = stintFirstSeenTimes(s.app, infoUptoMs);
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
      // Read from the merge at `infoUptoMs` — the same instant the car dots are rendering —
      // so a mini-sector lights up exactly as the car reaches it on screen, not 20s early.
      // Normalized to three dense slots so the UI can't receive holes (they serialize null).
      bestSectors: bestSectorOf[numStr] ?? [null, null, null],
      speeds: Object.fromEntries(
        Object.entries((t.Speeds ?? {}) as Record<string, { Value?: string; OverallFastest?: boolean; PersonalFastest?: boolean }>).map(
          ([k, v]) => [k, { value: v?.Value ?? "", overallFastest: Boolean(v?.OverallFastest), personalFastest: Boolean(v?.PersonalFastest) }],
        ),
      ),
      sectors: (() => {
        const raw = t.Sectors as unknown;
        const list = Array.isArray(raw)
          ? (raw as SectorRaw[])
          : raw && typeof raw === "object"
            ? Object.entries(raw as Record<string, SectorRaw>).reduce<SectorRaw[]>((acc, [k, v]) => {
                const i = Number(k);
                if (!Number.isNaN(i) && i >= 0 && i < 8) acc[i] = v;
                return acc;
              }, [])
            : [];
        return Array.from({ length: 3 }, (_, i) => {
          const sec = list[i];
          const segRaw = sec?.Segments as unknown;
          const segs = Array.isArray(segRaw)
            ? (segRaw as { Status?: number }[])
            : segRaw && typeof segRaw === "object"
              ? Object.entries(segRaw as Record<string, { Status?: number }>)
                  .reduce<{ Status?: number }[]>((acc, [k, v]) => {
                    const j = Number(k);
                    if (!Number.isNaN(j) && j >= 0 && j < 64) acc[j] = v;
                    return acc;
                  }, [])
              : [];
          return {
            // Only the CURRENT lap's time. F1 keeps the prior lap in PreviousValue, but
            // falling back to it meant a driver who had just started a lap still showed last
            // lap's three sector times — the bar should empty at the line and refill as each
            // sector is actually completed.
            // Blank unless this time was written AFTER the last line crossing.
            value: (valueSetAt[numStr]?.[i] ?? 0) >= (lapResetAt[numStr] ?? 0) ? sec?.Value || "" : "",
            overallFastest: Boolean(sec?.OverallFastest),
            personalFastest: Boolean(sec?.PersonalFastest),
            segments: Array.from({ length: segs.length }, (_, j) => Number(segs[j]?.Status ?? 0)),
          };
        });
      })(),
    };
    if (best != null && best < fastestMs && bt?.Value) {
      fastestMs = best;
      fastestLap = { driver_number: num, tla: s.drivers[numStr]?.Tla ?? numStr, time: bt.Value, lap: Number(bt.Lap ?? 0) };
    }
  }

  // Mini-sector transitions still "in flight": they've been published by F1 but the car dots
  // haven't reached them yet (the map renders `infoUptoMs`, data exists up to `uptoMs`).
  // Shipping them lets the client light each segment at the exact moment the dot arrives,
  // instead of the whole set stepping forward once per poll — which is what made the bars
  // visibly trail the car between polls.
  const segmentEvents: { t: number; n: number; s: number; i: number; c: number }[] = [];
  // When a driver crosses the line F1 blanks every mini-sector in one delta (measured: a
  // single update setting all three sectors' eight segments at once). Those resets sit in
  // the already-fetched window ahead of the dots, so shipping them lets the card blank at
  // the instant the car actually crosses rather than waiting for the next 3s poll.
  const lapResets: { t: number; n: number }[] = [];
  if (uptoMs > infoUptoMs) {
    for (const dlt of s.timing) {
      if (dlt.ts <= infoUptoMs) continue;
      if (dlt.ts > uptoMs) break;
      for (const [numStr, upd] of Object.entries(dlt.lines)) {
        const secs = (upd as { Sectors?: unknown }).Sectors;
        if (!secs || typeof secs !== "object") continue;
        for (const [sk, sv] of Object.entries(secs as Record<string, unknown>)) {
          const si = Number(sk);
          const segs = (sv as { Segments?: unknown })?.Segments;
          if (Number.isNaN(si) || !segs || typeof segs !== "object") continue;
          for (const [gk, gv] of Object.entries(segs as Record<string, { Status?: number }>)) {
            const gi = Number(gk);
            const code = Number(gv?.Status ?? NaN);
            if (!Number.isNaN(gi) && !Number.isNaN(code)) {
              segmentEvents.push({ t: dlt.ts, n: +numStr, s: si, i: gi, c: code });
            }
            // (blank count tallied below to spot a lap reset)
          }
        }
      }
    }
    // A delta that blanks a dozen or more mini-sectors for one driver is the line crossing.
    const blanked: Record<number, number> = {};
    for (const e of segmentEvents) if (e.c === 0) blanked[e.n] = (blanked[e.n] ?? 0) + 1;
    for (const dlt of s.timing) {
      if (dlt.ts <= infoUptoMs) continue;
      if (dlt.ts > uptoMs) break;
      for (const [numStr, upd] of Object.entries(dlt.lines)) {
        const secs = (upd as { Sectors?: unknown }).Sectors;
        if (!secs || typeof secs !== "object") continue;
        let zeros = 0;
        for (const sv of Object.values(secs as Record<string, { Segments?: unknown }>)) {
          const segs = sv?.Segments;
          if (!segs || typeof segs !== "object") continue;
          for (const gv of Object.values(segs as Record<string, { Status?: number }>)) {
            if (Number(gv?.Status ?? -1) === 0) zeros++;
          }
        }
        if (zeros >= 12) lapResets.push({ t: dlt.ts, n: +numStr });
      }
    }
  }

  const m = mode(sessionType);
  // Formation lap: after the anchor (which already backs off from SessionStatus:"Started"
  // to include it) but before the race has actually gone green — races only.
  const formationLap = m === "race" && s.sessionStartedTs != null && infoUptoMs < s.sessionStartedTs;
  const order = Object.keys(rows)
    .map(Number)
    .sort((a, b) => {
      if (m === "race") return rows[a].position - rows[b].position;
      const ba = rows[a].best ?? Infinity;
      const bb = rows[b].best ?? Infinity;
      // See the identical guard in liveSocket.ts: Infinity - Infinity is NaN, and a NaN
      // comparator leaves every yet-to-set-a-time driver in arbitrary order. Tie on position.
      if (ba === bb) return rows[a].position - rows[b].position;
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
  // Position buffer for smooth client playback (same shape the token socket emits).
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
    if (l.ts > infoUptoMs) break;
    if (l.data.CurrentLap != null) currentLap = Number(l.data.CurrentLap);
    if (l.data.TotalLaps != null) totalLaps = Number(l.data.TotalLaps);
  }

  // --- Red flag, restart countdown and extra formation laps ---------------------------
  // Ports the logic from liveSocket so the REPLAY path exercises it too — the two engines keep
  // separate F1LiveState shapes, so without this a replay showed none of it and a test could
  // not tell a broken fix from an absent one.
  //
  // SessionStatus is authoritative for a suspension. TrackStatus is not: it returns to "1"
  // (green) the moment marshals clear the track, while the race is still stopped.
  let sessionStatus: string | null = null;
  for (const h of s.statusHist) {
    if (h.ts > infoUptoMs) break;
    sessionStatus = h.status;
  }

  // Race control announces the restart as circuit-LOCAL wall clock, with no date and no zone
  // ("RACE WILL RESUME AT 15:33"). The message's own Utc stamp supplies the date and GmtOffset
  // the zone. The result is then rebased onto wall time: a replay runs a virtual clock, so an
  // absolute epoch out of the archive would count down to an instant already long past.
  let suspendedRestartMs: number | null = null;
  if (s.gmtOffset && sessionStatus === "Aborted") {
    const off = offsetMs(s.gmtOffset);
    let newest = -Infinity;
    let targetRel: number | null = null;
    for (const { ts, msg } of s.rc) {
      if (ts > infoUptoMs) break;
      const hit = /RESUME(?:D)? AT (\d{1,2}):(\d{2})/i.exec(msg.Message ?? "");
      if (!hit || !msg.Utc) continue;
      const sentAbs = Date.parse(msg.Utc + "Z");
      if (!Number.isFinite(sentAbs) || sentAbs <= newest) continue;
      const localDay = new Date(sentAbs + off);
      const targetAbs =
        Date.UTC(localDay.getUTCFullYear(), localDay.getUTCMonth(), localDay.getUTCDate(), +hit[1], +hit[2]) - off;
      targetRel = ts + (targetAbs - sentAbs);
      newest = sentAbs;
    }
    if (targetRel != null) suspendedRestartMs = Date.now() + (targetRel - infoUptoMs);
  }

  // Formation laps that follow a restart. The plain `formationLap` above cannot see these:
  // it is pinned to sessionStartedTs (lights out), so it is false ever after. F1 states them
  // outright, so read its words instead of inferring. See the matching note in liveSocket for
  // why the window closes off the lap counter.
  let restartForming = false;
  if (m === "race" && sessionStatus === "Started") {
    let newest = -Infinity;
    let lapOf: number | null = null;
    for (const { ts, msg } of s.rc) {
      if (ts > infoUptoMs) break;
      if (!/EXTRA FORMATION LAP|STANDING START/i.test(msg.Message ?? "")) continue;
      if (ts <= newest) continue;
      newest = ts;
      lapOf = Number(msg.Lap ?? 0) || null;
    }
    if (lapOf != null) restartForming = currentLap <= lapOf + 1;
  }

  // Track status at this instant (yellow/SC/red map tint).
  let trackStatus: string | null = null;
  for (const t of s.track) {
    if (t.ts > infoUptoMs) break;
    trackStatus = t.status;
  }

  // Which qualifying segment is live at this instant (1=Q1, 2=Q2, 3=Q3), and when it began
  // (for the live countdown — standard FIA durations: Q1 18min, Q2 15min, Q3 12min).
  let qualifyingPart: number | null = null;
  let qualifyingPartStartTs: number | null = null;
  for (const p of s.qp) {
    if (p.ts > infoUptoMs) break;
    qualifyingPart = p.part;
    qualifyingPartStartTs = p.ts;
  }
  // F1 announces the segment while the session is still being set up — minutes before the
  // lights go green — so the announcement instant is NOT when the segment started running.
  // The green light (SessionStatus "Started") is, for the first segment; later segments
  // legitimately begin after it, so take whichever is later. Without this the clock opened
  // a fresh segment already most of the way expired (see liveSocket.ts for the measured case).
  const segStart =
    qualifyingPartStartTs != null && s.sessionStartedTs != null
      ? Math.max(qualifyingPartStartTs, s.sessionStartedTs)
      : qualifyingPartStartTs;
  const segDurations = /sprint/i.test(sessionPath) ? SPRINT_QUALI_DURATION_MS : QUALI_DURATION_MS;
  // Segment clock, mirroring the live socket so replay behaves identically: a running
  // countdown, then "SQ1 ENDED" with an estimated countdown to the next segment's green
  // light during the break. The break length is MEASURED from this session's own earlier
  // Finished -> Started gap (scanning forward past the "Inactive" F1 emits between them),
  // falling back to the value measured at Zandvoort only for the first break.
  const hist = s.statusHist.filter((h) => h.ts <= infoUptoMs);
  const lastStarted = [...hist].reverse().find((h) => h.status === "Started")?.ts ?? null;
  const lastFinished = [...hist].reverse().find((h) => h.status === "Finished")?.ts ?? null;
  const partAnnouncedAt = qualifyingPartStartTs;
  const partRunning =
    lastStarted != null && (partAnnouncedAt == null || lastStarted >= partAnnouncedAt);
  const measuredBreak = (() => {
    let found: number | null = null;
    for (let i = 0; i < s.statusHist.length; i++) {
      if (s.statusHist[i].status !== "Finished") continue;
      const next = s.statusHist.slice(i + 1).find((h) => h.status === "Started");
      if (!next) continue;
      const obs = next.ts - s.statusHist[i].ts;
      if (obs > 60_000 && obs < 30 * 60_000) found = obs;
    }
    return found;
  })();
  const breakMs = measuredBreak ?? 7 * 60_000;

  let qualifyingRemainingMs: number | null = null;
  let qualifyingSegmentEnded = false;
  let nextQualifyingSegmentInMs: number | null = null;
  let effectivePart = qualifyingPart;

  if (qualifyingPart && segStart != null) {
    const assumedEnd = segStart + (segDurations[qualifyingPart] ?? 0);
    const finishedPerFeed = lastFinished != null && (lastStarted == null || lastFinished > lastStarted);
    if (!partRunning && qualifyingPart > 1) {
      // Announced but not yet green — still the BREAK after the previous segment.
      qualifyingSegmentEnded = true;
      effectivePart = qualifyingPart - 1;
      const until = lastFinished != null ? lastFinished + breakMs - infoUptoMs : null;
      nextQualifyingSegmentInMs = until != null && until > 0 ? until : null;
      qualifyingRemainingMs = 0;
    } else if (finishedPerFeed || infoUptoMs >= assumedEnd) {
      qualifyingSegmentEnded = true;
      qualifyingRemainingMs = 0;
      if (qualifyingPart < 3) {
        const endedAt = finishedPerFeed ? lastFinished! : assumedEnd;
        const until = endedAt + breakMs - infoUptoMs;
        nextQualifyingSegmentInMs = until > 0 ? until : null;
      }
    } else {
      qualifyingRemainingMs = Math.max(0, assumedEnd - infoUptoMs);
    }
  }

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
    qualifyingPart: effectivePart,
    qualifyingRemainingMs,
    qualifyingSegmentEnded,
    nextQualifyingSegmentInMs,
    formationLap: formationLap || restartForming,
    sessionStatus,
    suspendedRestartMs,
    durationMs: s.durationMs,
    segmentEvents,
    lapResets,
  };
}

/** Most-recent completed session's (Race or Qualifying — no token needed) top finishers/times
 *  from the free feed. Not just races: a session as recent as Qualifying should still show on
 *  the results ticker until the next session (typically the Race) actually goes live. */
export async function getStaticResults(): Promise<{
  session_name: string;
  mode: "race" | "quali" | "practice";
  complete: boolean;
  live: boolean;
  endedAtMs: number;
  top: { pos: number; tla: string; team_colour: string; best: number | null; gap: string }[];
} | null> {
  const now = Date.now();
  // Any completed session type — matches the token path (socketResults), which shows
  // whatever session F1's hub last had open, practice/sprint included. Restricting this to
  // race/qualifying only meant the free-feed (no-token) env never showed the results ticker
  // for a just-finished practice or sprint session at all.
  const session = (await flatSessions())
    .filter((s) => s.endMs <= now)
    .sort((a, b) => b.endMs - a.endMs)[0];
  if (!session) return null;
  const st = await getF1LiveState(session.path, session.type, Number.MAX_SAFE_INTEGER, false);
  if (!st.order.length) return null;
  const byNum = new Map(st.drivers.map((d) => [d.driver_number, d]));
  const top = st.order.map((n) => {
    const r = st.rows[n];
    const d = byNum.get(n);
    return { pos: r.position, tla: d?.name_acronym ?? String(n), team_colour: d?.team_colour ?? "", best: r.best, gap: r.gap_to_leader };
  });
  // Always a finished session — this picks the most recent one that has already ended.
  return { session_name: session.name, mode: mode(session.type), complete: true, live: false, endedAtMs: session.endMs, top };
}

/**
 * Resolves the (session path, instant, live-ness) the free-feed live panel is currently
 * showing — the exact same test-replay → live → fallback branching `/api/f1live` uses —
 * so `/api/racecontrol` can serve messages for that SAME session/instant without a token.
 * `view`/`replayT0` must be passed through from the client exactly as `/api/f1live` received
 * them, or Race Control ends up narrating a different point in the session than the map.
 *
 * `asOfMs`, when given, is the client's own map-playback clock (`getPlaybackT()` — the exact
 * session-relative instant the car dots are CURRENTLY rendering, which runs ~20s behind the
 * freshest fetched frame for smooth interpolation). Using it directly instead of recomputing
 * elapsed-time-since-t0 is what keeps Race Control's "as of" instant matched to what's on
 * screen — recomputing independently only kept the two loosely aligned (each polls on its own
 * cadence and neither accounts for the map's own render delay), which read as Race Control
 * running ahead of the drivers.
 */
export async function resolveFreeInstant(
  view: "live" | "replay" = "live",
  replayT0?: number,
  asOfMs?: number,
): Promise<{ path: string; uptoMs: number; live: boolean } | null> {
  if (F1_LIVE.replay.enabled) {
    const r = F1_LIVE.replay;
    if (asOfMs != null) return { path: r.sessionPath, uptoMs: asOfMs, live: false };
    const dur = await getSessionDuration(r.sessionPath, false);
    const anchor = Math.floor(dur * r.anchorFrac);
    const span = Math.max(1, dur - anchor);
    const upto = anchor + ((Date.now() - r.restartedAtMs) % span);
    return { path: r.sessionPath, uptoMs: upto, live: false };
  }

  if (view === "live") {
    const live = await resolveLiveSession();
    if (live && live.startWallMs != null) {
      return { path: live.path, uptoMs: asOfMs ?? Date.now() - live.startWallMs, live: true };
    }
    return null;
  }

  for (const c of await fallbackCandidates()) {
    const dur = await getSessionDuration(c.path, false);
    if (!dur) continue;
    if (asOfMs != null) return { path: c.path, uptoMs: asOfMs, live: false };
    const t0 = replayT0 ?? Date.now();
    const anchor = await getReplayAnchorMs(c.path, false);
    const span = Math.max(1, dur - anchor);
    const upto = anchor + ((Date.now() - t0) % span);
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
