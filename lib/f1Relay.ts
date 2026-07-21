/**
 * Relay to F1's official live-timing feed (SignalR Core), authenticated with an F1 TV
 * token. Server-only.
 *
 * Two ways this gets used:
 *  1. The site's own `F1_TV_TOKEN` — ONE persistent, long-lived connection shared by every
 *     visitor (the original design). Holds a continuously-buffered ~3.3 Hz Position.z stream
 *     so the client can play it back on a delay with smooth interpolation.
 *  2. A VISITOR's own token (`getVisitorRelayState`) — a fresh, isolated, short-lived
 *     connection per request: connect, collect a bounded window of updates, return, and
 *     always disconnect. Never shares state with the owner's session or with any other
 *     visitor. The token exists in server memory only for that one request.
 *
 * (Persistent connections need a long-running process — great locally / on a persistent
 * host. On stateless serverless the connection can't persist across invocations anyway, so
 * both paths converge on "reconnect and fetch a fresh window" there.)
 */
import "server-only";
import * as signalR from "@microsoft/signalr";
import WsImpl from "ws";
import zlib from "zlib";
import { DRY_COMPOUNDS, parseLapTime, weekendTyresLeftForMeeting, WEEKEND_ALLOCATION } from "./f1feed";
import { looksLikeJwt } from "./tokenExpiry";

const g = globalThis as unknown as { WebSocket?: unknown };
if (typeof g.WebSocket === "undefined") g.WebSocket = WsImpl;

const HUB = "https://livetiming.formula1.com/signalrcore";
const TOPICS = ["DriverList", "TimingData", "TimingAppData", "Position.z", "SessionInfo", "SessionStatus", "ChampionshipPrediction", "RaceControlMessages", "TrackStatus", "LapCount", "CarData.z", "SessionData"];
const ENDED = new Set(["finished", "finalised", "ends"]);
const BUFFER_MS = 45_000; // keep ~45s of position frames (covers a 20s playback delay)
const QUALI_DURATION_MS: Record<number, number> = { 1: 18 * 60_000, 2: 15 * 60_000, 3: 12 * 60_000 };
const LIVE_GRACE_MS = 120_000; // keep live tracking on 2 min after a session ends
const WEEKEND_FLIP_MS = 300_000; // flip the hero to the next weekend 5 min after the race ends
// A visitor's connection stays open just long enough to catch a few incremental position/
// telemetry updates beyond the initial snapshot, then always tears down — never held any
// longer than this per request, regardless of how long the visitor keeps polling.
const VISITOR_COLLECT_MS = 2_500;
const MAX_CONCURRENT_VISITOR_CONNECTIONS = 20;

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
interface RcMessage {
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
export interface TelFrame {
  t: number; // epoch ms (sample's own Utc)
  c: Record<string, [number, number, number, number]>; // num → [rpm, speed, gear, throttle]
}
type SessionInfo = {
  Key?: number;
  Type?: string;
  Name?: string;
  StartDate?: string;
  EndDate?: string;
  GmtOffset?: string;
  ArchiveStatus?: { Status?: string };
  Meeting?: { Name?: string; Number?: number; Location?: string; Circuit?: { ShortName?: string; Key?: number } };
};
type Championship = {
  Drivers?: Record<string, { PredictedPoints?: number }>;
  Teams?: Record<string, { TeamName?: string; PredictedPoints?: number }>;
};

/* ------------------------------- derivation types -------------------------------- */
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
  retired: boolean; // crashed / DNF (feed Retired or Stopped)
  knocked_out: boolean; // eliminated in a prior quali segment (feed KnockedOut)
  grid: number; // starting grid position (0 = unknown) — for gained/lost indicator
  stints: { compound: string; laps: number; age: number; isNew: boolean; segment: number | null }[]; // full tyre history (strategy bar)
  weekendTyresLeft: { compound: string; left: number }[]; // fresh sets left vs. the weekend allocation
}
export interface FastestLap {
  driver_number: number;
  tla: string;
  time: string; // e.g. "1:33.562"
  lap: number;
}
export interface F1LiveState {
  mode: "race" | "quali" | "practice";
  session: { location: string; session_name: string };
  circuitKey?: number;
  drivers: F1LiveDriver[];
  order: number[];
  rows: Record<number, F1LiveRow>;
  frames: PosFrame[]; // recent window for smooth client playback
  totalLaps: number; // race distance (0 outside a race) — strategy bar axis
  currentLap: number;
  fastestLap: FastestLap | null;
  trackStatus: string | null; // TrackStatus code (1 clear, 2 yellow, 4 SC, 5 red, 6 VSC, 7 VSC ending)
  telFrames: TelFrame[]; // recent timestamped telemetry window (client plays back at the map's clock)
  qualifyingPart: number | null; // 1=Q1, 2=Q2, 3=Q3 (quali sessions only)
  qualifyingRemainingMs: number | null; // live countdown in the current segment
}
export interface SessionResult {
  session_name: string;
  mode: "race" | "quali" | "practice";
  complete: boolean;
  endedAtMs?: number; // when the session ended — client hides the bar 24h later
  top: { pos: number; tla: string; team_colour: string; best: number | null; gap: string }[];
}
export type VisitorRelayResult =
  | { status: "ok"; state: F1LiveState }
  | { status: "invalid_token" }
  | { status: "no_session" }
  | { status: "too_many" };

/* --------------------------- pure helpers (no session state) --------------------------- */
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

function offsetMs(gmt?: string): number {
  const m = gmt?.match(/(-?\d{1,2}):(\d{2}):(\d{2})/);
  if (!m) return 0;
  const sign = m[1].startsWith("-") ? -1 : 1;
  return sign * (Math.abs(+m[1]) * 3600 + +m[2] * 60 + +m[3]) * 1000;
}

function modeOf(type?: string): F1LiveState["mode"] {
  const t = (type ?? "").toLowerCase();
  if (t.includes("qual")) return "quali";
  if (t.includes("practice")) return "practice";
  return "race";
}

/**
 * Tyre-age (TimingAppData) and lap-count (TimingData) are two independently-updating feed
 * topics — around Safety Car / Red Flag periods they can drift a few laps out of sync, so a
 * driver's stint widths can sum to MORE than their actual completed laps (bars overshooting
 * the shared lap axis / not lining up between drivers). Clamp the total to the driver's real
 * lap count, trimming the CURRENT (most recent) stint first since it's the one still live.
 */
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

/**
 * Everything below is ONE session's worth of connection + state + derivation, in a factory
 * so it can be instantiated either once (the owner's persistent singleton, below) or fresh
 * per visitor request (`getVisitorRelayState`) with zero shared state between instances.
 */
function createRelaySession() {
  let conn: signalR.HubConnection | null = null;
  let starting: Promise<void> | null = null;
  let lastRefresh = 0;

  let timing: Record<string, Dict> = {};
  let app: Record<string, Dict> = {};
  let drivers: Record<string, RawDriver> = {};
  let sessionInfo: SessionInfo | null = null;
  let sessionStatus: { Status?: string } | null = null;
  let frameBuffer: PosFrame[] = [];
  // Live championship projection — PERSISTS across sessions (not reset by resetOnNewSession),
  // so post-race points survive after the feed clears the topic, until Jolpica catches up.
  let championship: Championship | null = null;
  // Per-event race control messages (keyed by index) + track status — reset per session.
  let raceControl: Record<string, RcMessage> = {};
  let trackStatus: { Status?: string; Message?: string } | null = null;
  // Race lap counter (races only) — drives the tyre-strategy bar's lap axis.
  let lapCount: { CurrentLap?: number; TotalLaps?: number } | null = null;
  // Which qualifying segment is live (1=Q1, 2=Q2, 3=Q3) — from SessionData's QualifyingPart.
  let qualifyingPart: number | null = null;
  // FULL history of when each segment began (epoch ms) — powers the live countdown AND lets
  // each tyre stint be attributed to the segment it started in (stintFirstSeenAt below).
  let qualifyingPartHistory: { startMs: number; part: number }[] = [];
  // driver num -> stint index -> epoch ms it was FIRST seen, so a stint can be matched to the
  // qualifyingPartHistory entry active at that moment (which Q1/Q2/Q3 it began in).
  let stintFirstSeenAt: Record<string, Record<string, number>> = {};
  // Rolling buffer of timestamped car telemetry (CarData.z channels: 0=RPM 2=Speed 3=Gear
  // 4=Throttle) — ~4Hz per-sample Utc, played back by the client on the same delayed clock
  // as the position dots so the card matches the car on screen and updates continuously.
  let telBuffer: TelFrame[] = [];
  // When the current session first ended (epoch ms) — powers the live-tracking grace and
  // the hero's "race ended → flip to next weekend" timing. Only set if we actually SAW the
  // session live (so connecting long after a race can't fake a fresh "just ended"). Reset per session.
  let endedAt: number | null = null;
  let sawLive = false;

  function resetOnNewSession(info: NonNullable<typeof sessionInfo>) {
    if (sessionInfo?.Key && info?.Key && info.Key !== sessionInfo.Key) {
      timing = {};
      app = {};
      drivers = {};
      frameBuffer = [];
      sessionStatus = null;
      raceControl = {};
      trackStatus = null;
      lapCount = null;
      qualifyingPart = null;
      qualifyingPartHistory = [];
      stintFirstSeenAt = {};
      telBuffer = [];
      endedAt = null;
      sawLive = false;
    }
    sessionInfo = info;
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

  function applyCarData(payload: string) {
    try {
      const dec = JSON.parse(zlib.inflateRawSync(Buffer.from(payload, "base64")).toString("utf8")) as {
        Entries?: { Utc?: string; Cars?: Record<string, { Channels?: Record<string, number> }> }[];
      };
      let lastT = telBuffer.at(-1)?.t ?? 0;
      for (const e of dec.Entries ?? []) {
        const t = e.Utc ? Date.parse(e.Utc) : NaN;
        if (!Number.isFinite(t) || t <= lastT || !e.Cars) continue; // re-Subscribe snapshots overlap
        const c: TelFrame["c"] = {};
        for (const [num, car] of Object.entries(e.Cars)) {
          const ch = car.Channels;
          if (ch) c[num] = [ch["0"] ?? 0, ch["2"] ?? 0, ch["3"] ?? 0, ch["4"] ?? 0];
        }
        if (Object.keys(c).length) {
          telBuffer.push({ t, c });
          lastT = t;
        }
      }
      const cutoff = (telBuffer.at(-1)?.t ?? 0) - BUFFER_MS;
      if (telBuffer.length > 40 && telBuffer[0].t < cutoff) telBuffer = telBuffer.filter((f) => f.t >= cutoff);
    } catch {}
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
              if (s && typeof s === "object") {
                deepMerge((store[idx] ??= {}), s as Dict);
                const seen = (stintFirstSeenAt[n] ??= {});
                if (seen[idx] === undefined) seen[idx] = Date.now();
              }
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
    } else if (topic === "RaceControlMessages") {
      // Snapshot: { Messages: [...] } (array). Deltas: { Messages: { "64": {...} } } (index-keyed).
      const m = (data as { Messages?: unknown }).Messages;
      if (Array.isArray(m)) {
        m.forEach((msg, i) => (raceControl[String(i)] = msg as RcMessage));
      } else if (m && typeof m === "object") {
        for (const [k, v] of Object.entries(m as Dict)) raceControl[k] = v as RcMessage;
      }
    } else if (topic === "TrackStatus") {
      trackStatus = data as typeof trackStatus;
    } else if (topic === "LapCount") {
      lapCount = { ...(lapCount ?? {}), ...(data as { CurrentLap?: number; TotalLaps?: number }) };
    } else if (topic === "SessionData") {
      // Series is index-keyed deltas: { "2": { Utc, QualifyingPart: 2 } }. Only Qualifying
      // sessions carry this; keep the latest value seen (1=Q1, 2=Q2, 3=Q3) and record when
      // it started (for the live countdown + attributing stints to the segment they began in).
      const series = (data as { Series?: Record<string, { Utc?: string; QualifyingPart?: number }> }).Series;
      for (const v of Object.values(series ?? {})) {
        if (v.QualifyingPart != null) {
          qualifyingPart = v.QualifyingPart;
          const startMs = v.Utc ? Date.parse(v.Utc) : Date.now();
          qualifyingPartHistory.push({ startMs, part: v.QualifyingPart });
        }
      }
    } else if (topic === "Position.z") {
      pushFrames(data as string);
    } else if (topic === "CarData.z") {
      applyCarData(data as string);
    }
  }

  function applySnapshot(snap: Record<string, unknown>) {
    if (!snap) return;
    if (snap.SessionInfo) resetOnNewSession(snap.SessionInfo as NonNullable<typeof sessionInfo>);
    if (snap.SessionStatus) sessionStatus = snap.SessionStatus as typeof sessionStatus;
    if (snap.ChampionshipPrediction) applyFeed("ChampionshipPrediction", snap.ChampionshipPrediction);
    if (snap.RaceControlMessages) applyFeed("RaceControlMessages", snap.RaceControlMessages);
    if (snap.TrackStatus) applyFeed("TrackStatus", snap.TrackStatus);
    if (snap.LapCount) applyFeed("LapCount", snap.LapCount);
    if (snap.SessionData) applyFeed("SessionData", snap.SessionData);
    if (snap.DriverList) applyFeed("DriverList", snap.DriverList);
    if (snap.TimingData) applyFeed("TimingData", snap.TimingData);
    if (snap.TimingAppData) applyFeed("TimingAppData", snap.TimingAppData);
    if (snap["Position.z"]) pushFrames(snap["Position.z"] as string);
    if (snap["CarData.z"]) applyCarData(snap["CarData.z"] as string);
  }

  /** `tokenOverride` lets a visitor's own token be used instead of the site's F1_TV_TOKEN —
   *  everything else about the connection is identical either way. */
  async function ensureConnection(tokenOverride?: string): Promise<boolean> {
    const token = tokenOverride ?? process.env.F1_TV_TOKEN?.trim();
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

  /** Connect with an explicit (visitor) token and stay open for `collectMs` so a few
   *  incremental position/telemetry updates land beyond the initial snapshot. Does NOT loop
   *  or self-refresh afterward — the caller reads state once, then disconnects. */
  async function connectAndCollect(token: string, collectMs: number): Promise<boolean> {
    const ok = await ensureConnection(token);
    if (!ok) return false;
    await new Promise((r) => setTimeout(r, collectMs));
    return true;
  }

  /** Always safe to call, even if never connected. The owner's singleton never calls this
   *  (its connection is meant to live for the process lifetime); every visitor session must. */
  async function disconnect() {
    try {
      await conn?.stop();
    } catch {}
    conn = null;
  }

  /** Which qualifying segment (1/2/3) was active at a given epoch ms, from the history of
   *  segment-start times. Falls back to Q1 if a stint predates the first recorded transition
   *  (e.g. we connected mid-Q1, before any SessionData message had arrived). */
  function segmentAt(ms: number): number | null {
    if (!qualifyingPartHistory.length) return null;
    let seg = qualifyingPartHistory[0].part;
    for (const h of qualifyingPartHistory) {
      if (h.startMs <= ms) seg = h.part;
      else break;
    }
    return seg;
  }

  /** Every stint a driver has run, in order (laps = race laps this stint, age = laps on tyre). */
  function allStints(
    numStr: string,
  ): { compound: string; laps: number; age: number; isNew: boolean; segment: number | null }[] {
    const st = app[numStr]?.Stints as unknown;
    let entries: [string, Dict][] = [];
    if (Array.isArray(st)) entries = (st as Dict[]).map((s, i) => [String(i), s]);
    else if (st && typeof st === "object") {
      entries = Object.keys(st as Dict)
        .map(Number)
        .sort((a, b) => a - b)
        .map((k) => [String(k), (st as Dict)[k] as Dict]);
    }
    return entries
      .map(([idx, s]) => {
        const total = Number((s as { TotalLaps?: number }).TotalLaps ?? 0);
        const start = Number((s as { StartLaps?: number }).StartLaps ?? 0);
        const compound = String((s as { Compound?: string }).Compound ?? "").toUpperCase();
        // "New" arrives as the STRING "true"/"false", not a real boolean.
        const isNew = String((s as { New?: string | boolean }).New) === "true";
        const firstSeen = stintFirstSeenAt[numStr]?.[idx];
        const segment = firstSeen != null ? segmentAt(firstSeen) : null;
        // laps = race laps this stint (bar width); age = laps on that tyre (icon number).
        return { compound: compound || "UNKNOWN", laps: Math.max(0, total - start), age: total, isNew, segment };
      })
      .filter((s) => s.compound !== "UNKNOWN" || s.laps > 0);
  }

  /** How many fresh sets of each dry compound have been mounted so far THIS live session,
   *  per driver — the live-session half of the weekend allocation tally (the other half,
   *  FP1–3, comes from the free static feed via weekendTyresLeftForMeeting). */
  function countNewSetsLive(): Record<string, Record<string, number>> {
    const out: Record<string, Record<string, number>> = {};
    for (const [numStr, upd] of Object.entries(app)) {
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

  /** Current tyre: last stint, with tyre AGE (TotalLaps incl. any scrub) for the board. */
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
    if (!sessionInfo) {
      endedAt = null;
      sawLive = false;
      return false;
    }
    const status = (sessionStatus?.Status ?? "").toLowerCase();
    if (sessionInfo.ArchiveStatus?.Status === "Complete" || ENDED.has(status)) {
      // Only stamp an end time if we actually watched it run — otherwise connecting hours
      // after the flag (or a dev hot-reload) would fake a fresh "just ended".
      if (sawLive && endedAt == null) endedAt = Date.now();
      return false;
    }
    endedAt = null; // still running (or resumed after a red flag)
    let live: boolean;
    if (sessionInfo.StartDate) {
      const startMs = Date.parse(sessionInfo.StartDate + "Z") - offsetMs(sessionInfo.GmtOffset);
      live = Number.isFinite(startMs) && Date.now() >= startMs - 60_000;
    } else {
      live = status === "started" || status === "aborted";
    }
    if (live) sawLive = true;
    return live;
  }

  /** Live, OR within the short grace window after a session ends (keeps the map/board up). */
  function liveOrGrace(): boolean {
    if (liveNow()) return true;
    return endedAt != null && Date.now() < endedAt + LIVE_GRACE_MS;
  }

  function classify() {
    const nums = Object.keys(timing).filter((k) => /^\d+$/.test(k) && Object.keys(timing[k]).length);
    const mode = modeOf(sessionInfo?.Type);
    const rows: Record<number, F1LiveRow> = {};
    let fastestLap: FastestLap | null = null;
    let fastestMs = Infinity;
    for (const n of nums) {
      const t = timing[n] as {
        Position?: string | number;
        Line?: number;
        GapToLeader?: string;
        IntervalToPositionAhead?: { Value?: string };
        BestLapTime?: { Value?: string; Lap?: number };
        LastLapTime?: { Value?: string };
        NumberOfLaps?: number;
        InPit?: boolean;
        Retired?: boolean;
        Stopped?: boolean;
        KnockedOut?: boolean;
      };
      const stint = currentStint(n);
      const best = parseLapTime(t.BestLapTime?.Value);
      const numberOfLaps = +(t.NumberOfLaps ?? 0);
      rows[+n] = {
        driver_number: +n,
        position: +(t.Position ?? t.Line ?? 99),
        gap_to_leader: t.GapToLeader ?? "",
        interval: t.IntervalToPositionAhead?.Value ?? "",
        best,
        last: parseLapTime(t.LastLapTime?.Value),
        laps: numberOfLaps,
        compound: stint.compound,
        tyre_laps: stint.laps,
        in_pit: Boolean(t.InPit),
        retired: Boolean(t.Retired || t.Stopped),
        knocked_out: Boolean(t.KnockedOut),
        grid: Number((app[n] as { GridPos?: string | number })?.GridPos ?? 0),
        stints: clampStintsToLaps(allStints(n), numberOfLaps),
        weekendTyresLeft: DRY_COMPOUNDS.map((c) => ({ compound: c, left: WEEKEND_ALLOCATION[c] })), // filled in below
      };
      if (best != null && best < fastestMs && t.BestLapTime?.Value) {
        fastestMs = best;
        fastestLap = { driver_number: +n, tla: drivers[n]?.Tla ?? String(n), time: t.BestLapTime.Value, lap: Number(t.BestLapTime.Lap ?? 0) };
      }
    }
    const order = nums.map(Number).sort((a, b) => (mode === "race" ? rows[a].position - rows[b].position : (rows[a].best ?? Infinity) - (rows[b].best ?? Infinity)));
    return { nums, mode, rows, order, fastestLap };
  }

  async function getRelayState(): Promise<F1LiveState | null> {
    if (!(await ensureConnection())) return null;
    await refreshIfStale();
    if (!sessionInfo || !liveOrGrace()) return null;

    const { nums, mode, rows, order, fastestLap } = classify();
    if (!nums.length) return null;

    const driverList: F1LiveDriver[] = Object.entries(drivers).map(([k, d]) => ({
      driver_number: +k,
      name_acronym: d.Tla ?? String(k),
      team_colour: d.TeamColour ?? "",
      team_name: d.TeamName ?? "",
      full_name: d.FullName ?? "",
    }));

    // Weekend tyre allocation — quali and race (matches the card's own visibility). Needs the
    // current session's own start time to know which past FP1–3/Quali sessions of the same
    // meeting count against the same allocation.
    if ((mode === "quali" || mode === "race") && sessionInfo.Meeting?.Name && sessionInfo.StartDate) {
      const beforeStartMs = Date.parse(sessionInfo.StartDate + "Z") - offsetMs(sessionInfo.GmtOffset);
      try {
        const weekendMap = await weekendTyresLeftForMeeting(sessionInfo.Meeting.Name, beforeStartMs, countNewSetsLive());
        for (const n of nums) if (weekendMap[n]) rows[+n].weekendTyresLeft = weekendMap[n];
      } catch {}
    }

    return {
      mode,
      session: { location: sessionInfo.Meeting?.Location ?? sessionInfo.Meeting?.Circuit?.ShortName ?? "F1", session_name: sessionName() },
      circuitKey: sessionInfo.Meeting?.Circuit?.Key,
      drivers: driverList,
      order,
      rows,
      frames: frameBuffer.slice(-150), // ~45s window (covers the 20s delay + jitter)
      totalLaps: mode === "race" ? Number(lapCount?.TotalLaps ?? 0) : 0,
      currentLap: Number(lapCount?.CurrentLap ?? 0),
      fastestLap,
      trackStatus: trackStatus?.Status ?? null,
      telFrames: telBuffer.slice(-200), // ~45s at ~4Hz
      qualifyingPart,
      qualifyingRemainingMs:
        qualifyingPart && qualifyingPartHistory.length
          ? Math.max(0, QUALI_DURATION_MS[qualifyingPart] - (Date.now() - qualifyingPartHistory.at(-1)!.startMs))
          : null,
    };
  }

  /**
   * Live championship projection from the feed — instant updated points during/right
   * after a Sprint or Race, keyed by driver TLA and constructor name. `round` is the
   * meeting number so the client can prefer Jolpica once it has caught up.
   */
  async function getChampionship(): Promise<{
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

  /** Race control messages for the current event — only while a session is live. */
  async function getRaceControl(): Promise<{
    available: boolean;
    trackStatus?: { Status?: string; Message?: string } | null;
    messages?: RcMessage[];
  }> {
    if (!(await ensureConnection())) return { available: false };
    await refreshIfStale();
    if (!sessionInfo || !liveOrGrace()) return { available: false };
    const messages = Object.values(raceControl)
      .filter((m) => m.Message)
      .sort((a, b) => (b.Utc ?? "").localeCompare(a.Utc ?? ""))
      .slice(0, 150);
    if (!messages.length) return { available: false };
    return { available: true, trackStatus, messages };
  }

  /** Lightweight "is a session live and which one" — for the hero + schedule. */
  async function getLiveStatus(): Promise<{
    live: boolean;
    name?: string;
    type?: string;
    endedAt?: number; // epoch ms the current session ended (drives the hero flip)
    round?: number; // meeting/round number of the current session
  }> {
    if (!(await ensureConnection())) return { live: false };
    await refreshIfStale();
    if (!sessionInfo) return { live: false };
    const live = liveNow(); // also maintains endedAt
    return {
      live,
      name: sessionName(),
      type: sessionInfo.Type,
      endedAt: endedAt ?? undefined,
      round: sessionInfo.Meeting?.Number,
    };
  }

  /**
   * The just-ended RACE weekend (main Grand Prix only), once it's over — so the hero can
   * flip to the next round 5 min after the flag. Null until then / without a token.
   */
  async function getEndedWeekend(): Promise<{ round: number; flipReady: boolean } | null> {
    if (!(await ensureConnection())) return null;
    await refreshIfStale();
    if (!sessionInfo) return null;
    liveNow(); // maintain endedAt
    const isRace = (sessionInfo.Type ?? "").toLowerCase() === "race";
    if (!isRace || endedAt == null) return null;
    return { round: Number(sessionInfo.Meeting?.Number ?? 0), flipReady: Date.now() >= endedAt + WEEKEND_FLIP_MS };
  }

  async function getRelayResults(): Promise<SessionResult | null> {
    if (!(await ensureConnection())) return null;
    await refreshIfStale();
    if (!sessionInfo) return null;
    const { nums, mode, rows, order } = classify();
    if (!nums.length) return null;
    const complete = sessionInfo.ArchiveStatus?.Status === "Complete" || ENDED.has((sessionStatus?.Status ?? "").toLowerCase());
    const off = offsetMs(sessionInfo.GmtOffset);
    const endedAtMs = sessionInfo.EndDate
      ? Date.parse(sessionInfo.EndDate + "Z") - off
      : sessionInfo.StartDate
        ? Date.parse(sessionInfo.StartDate + "Z") - off + 9_000_000 // ~2.5h after start if no EndDate
        : undefined;
    return {
      session_name: sessionName(),
      mode,
      complete,
      endedAtMs,
      top: order.map((n) => ({ pos: rows[n].position, tla: drivers[n]?.Tla ?? String(n), team_colour: drivers[n]?.TeamColour ?? "", best: rows[n].best, gap: rows[n].gap_to_leader })),
    };
  }

  return {
    ensureConnection,
    connectAndCollect,
    disconnect,
    getRelayState,
    getChampionship,
    getRaceControl,
    getLiveStatus,
    getEndedWeekend,
    getRelayResults,
  };
}

/* --------------------------- the owner's persistent singleton --------------------------- */
// Unchanged behavior: one shared connection using the site's own F1_TV_TOKEN, for the
// lifetime of the server process — exactly as before this file was refactored into a factory.
const ownerSession = createRelaySession();
export const getRelayState = ownerSession.getRelayState;
export const getChampionship = ownerSession.getChampionship;
export const getRaceControl = ownerSession.getRaceControl;
export const getLiveStatus = ownerSession.getLiveStatus;
export const getEndedWeekend = ownerSession.getEndedWeekend;
export const getRelayResults = ownerSession.getRelayResults;

/* --------------------------- per-visitor, bring-your-own-token --------------------------- */
let activeVisitorConnections = 0;

/**
 * A visitor's own F1 TV token, used for exactly one request: connect fresh, collect a
 * bounded window of updates, read the state, then ALWAYS disconnect — never shared with the
 * owner's session, never shared with any other visitor, never cached or reused across polls.
 * The token exists in server memory only for the few seconds this call takes to run, and is
 * never logged, written to disk, or placed in a URL anywhere in this path.
 */
export async function getVisitorRelayState(token: string): Promise<VisitorRelayResult> {
  if (!looksLikeJwt(token)) return { status: "invalid_token" };
  if (activeVisitorConnections >= MAX_CONCURRENT_VISITOR_CONNECTIONS) return { status: "too_many" };

  activeVisitorConnections++;
  const session = createRelaySession();
  try {
    const connected = await session.connectAndCollect(token, VISITOR_COLLECT_MS);
    if (!connected) return { status: "invalid_token" };
    const state = await session.getRelayState();
    return state ? { status: "ok", state } : { status: "no_session" };
  } catch {
    return { status: "invalid_token" };
  } finally {
    await session.disconnect();
    activeVisitorConnections--;
  }
}
