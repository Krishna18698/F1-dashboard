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
// Sprint Qualifying (SQ1/SQ2/SQ3) runs shorter segments than a Saturday qualifying — the
// whole session is ~44 min end-to-end where a normal quali is ~60. Both arrive with
// Type "Qualifying", so they're only distinguishable by name.
const SPRINT_QUALI_DURATION_MS: Record<number, number> = { 1: 12 * 60_000, 2: 10 * 60_000, 3: 8 * 60_000 };
function qualiSegmentMs(part: number, sessionName?: string): number {
  const sprint = /sprint/i.test(sessionName ?? "");
  return (sprint ? SPRINT_QUALI_DURATION_MS : QUALI_DURATION_MS)[part] ?? 0;
}
// Gap between the end of one segment and the green light of the next. Measured off F1's own
// StatusSeries at Zandvoort SQ: SQ1 Finished 14:42:00 -> SQ2 Started 14:49:00, and SQ2
// Finished 14:59:00 -> SQ3 Started 15:06:00 — 7 min both times. A Saturday qualifying's
// breaks aren't measured yet, so it uses the same value until one is observed. This is only
// ever used to COUNT DOWN to the next segment; the moment F1 actually starts it, the real
// segment clock takes over, so an inaccurate estimate self-corrects rather than persisting.
const QUALI_BREAK_MS = 7 * 60_000;
const QUALI_LAST_PART = 3;
const LIVE_GRACE_MS = 120_000; // keep live tracking on 2 min after a session ends
// How long the FINAL classification stays on the Driver Live Tracker after a session ends,
// measured from F1's OWN "Finished" timestamp. Then the tracker goes idle. The result isn't
// lost when this lapses — the hero results ticker keeps it for 24h, which is the right home
// for "what happened earlier"; the live tracker is for what's happening now.
const SHOW_FINISHED_MAX_MS = 2 * 60_000;
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
export interface SectorTime {
  value: string; // e.g. "31.490" — empty while the sector is still being run
  overallFastest: boolean; // purple: fastest anyone has gone in this sector
  personalFastest: boolean; // green: this driver's own best
  segments: number[]; // raw mini-sector Status codes (see MINI_SECTOR docs in the UI)
}
export interface SpeedTrap {
  value: string;
  overallFastest: boolean;
  personalFastest: boolean;
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
  sectors: SectorTime[]; // S1/S2/S3 with F1's own purple/green flags
  speeds: Record<string, SpeedTrap>; // I1 / I2 / FL / ST speed traps
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
  /** Current segment's clock has run out and the next one hasn't gone green yet. */
  qualifyingSegmentEnded: boolean;
  /** Estimated ms until the NEXT segment starts, during that break. Null on the last
   *  segment, or once the estimate has elapsed and we're just waiting on F1. */
  nextQualifyingSegmentInMs: number | null;
  formationLap: boolean; // race hasn't gone green yet (SessionData StatusSeries "Started")
  /**
   * Whether car POSITIONS can be served at all. True on any token-backed connection; false
   * on an anonymous one — F1 gates Position.z/CarData.z behind a token while serving the
   * timing topics to anyone. Lets the UI distinguish "no frames have arrived yet" from
   * "frames will never arrive", and show an honest placeholder instead of a dead map.
   */
  mapAvailable: boolean;
  /** Session is over, but this is still F1's current session — the board is showing a FINAL
   *  classification rather than a live one. */
  sessionEnded: boolean;
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
/** True for {"0":…,"3":…} — F1's shorthand for "these indices of an array changed". */
function isIndexPatch(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const keys = Object.keys(v as Record<string, unknown>);
  return keys.length > 0 && keys.every((k) => /^\d+$/.test(k));
}

function deepMerge(target: Dict, src: Dict) {
  for (const [k, v] of Object.entries(src)) {
    const cur = target[k];
    // See the matching guard in f1feed.ts: an index-keyed patch against a stored array must
    // merge by index instead of replacing the array with just the changed member.
    if (Array.isArray(cur) && isIndexPatch(v)) {
      for (const [ik, iv] of Object.entries(v)) {
        const i = Number(ik);
        const slot = (cur as unknown[])[i];
        if (iv && typeof iv === "object" && !Array.isArray(iv) && slot && typeof slot === "object" && !Array.isArray(slot)) {
          deepMerge(slot as Dict, iv as Dict);
        } else {
          (cur as unknown[])[i] = iv;
        }
      }
      continue;
    }
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

/** F1 sends repeated structures as arrays in the Subscribe snapshot but as index-keyed
 *  objects in incremental deltas ({"0":{...},"2":{...}}), and deepMerge preserves whichever
 *  arrived. `allStints` already deals with this for tyre stints; sectors/segments need the
 *  same treatment or `.map` throws on a live delta and the whole route 500s. */
function asList<T>(v: unknown, minLength = 0): (T | undefined)[] {
  const pad = (a: (T | undefined)[]) => {
    // A sparse array serializes its holes as `null`, which then blows up any consumer doing
    // `x.foo` on the client. Materialize every slot up to minLength so the wire format is
    // always dense.
    for (let i = 0; i < Math.max(minLength, a.length); i++) if (!(i in a)) a[i] = undefined;
    return a;
  };
  if (Array.isArray(v)) return pad([...(v as T[])]);
  if (v && typeof v === "object") {
    // Place each entry at ITS OWN numeric key, not in encounter order. A delta often carries
    // just the one member that changed ({"1": {...}} = sector 2 only); compacting that into a
    // dense array moved sector 2's data to index 0, so S1 displayed S2's time (seen live:
    // ANT showing 28.294 for both S1 and S2). Gaps stay undefined and fall back to the
    // remembered value for that slot.
    const out: (T | undefined)[] = [];
    for (const k of Object.keys(v as Record<string, T>)) {
      const i = Number(k);
      if (!Number.isNaN(i) && i >= 0 && i < 64) out[i] = (v as Record<string, T>)[k];
    }
    return pad(out);
  }
  return pad([]);
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
function createRelaySession(opts: { allowAnonymous?: boolean } = {}) {
  let conn: signalR.HubConnection | null = null;
  let starting: Promise<void> | null = null;
  let lastRefresh = 0;
  // True once connected WITHOUT any token (see ensureConnection). Everything the map needs
  // is missing in that mode, so callers must be able to tell "no cars to show" apart from
  // "not allowed to see the cars".
  let anonymous = false;

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
  // SessionData's StatusSeries carries SessionStatus:"Started" — F1's own explicit race-start
  // signal (same one the free-feed replay path anchors formation-lap detection to).
  let sessionStartedTs: number | null = null;
  // The LATEST SessionStatus:"Started", as opposed to the first. A qualifying session emits
  // one per segment (measured at Zandvoort SQ: Started 14:30:00 → Finished 14:42:00 for SQ1,
  // then another pair for SQ2), so this is what marks the current segment actually going
  // green. `sessionStartedTs` deliberately stays pinned to the first one — that's lights-out
  // for formation-lap detection, a different question.
  let segmentStartedTs: number | null = null;
  // F1's own timestamp for the chequered flag / session end (StatusSeries "Finished"). Unlike
  // endedAt / raceLapsCompleteAt this is the REAL instant, not when this process happened to
  // notice — so "how long ago did it end" survives a fresh connection or a serverless restart.
  let sessionFinishedTs: number | null = null;
  // Ordered SessionStatus transitions with F1's own timestamps ("Started"/"Finished"/...).
  // Qualifying emits a Started+Finished pair PER SEGMENT, so this is what lets the segment
  // clock use real boundaries instead of assumed durations, and lets the inter-segment break
  // be MEASURED from this very session rather than assumed.
  let statusHistory: { ts: number; status: string }[] = [];
  // Last COMPLETED sector reading per driver. F1 blanks Value (and PreviousValue) for every
  // sector the moment a driver starts a new lap, so a card showing the raw feed empties out
  // to "-" for most of each lap and refills as sectors are set — which reads as flickering.
  // F1's own graphics keep the previous lap's sectors on screen until new ones replace them;
  // this is that memory.
  let lastSectors: Record<string, { value: string; overallFastest: boolean; personalFastest: boolean }[]> = {};
  /**
   * Timestamped history of each driver's sector/mini-sector state.
   *
   * The map deliberately renders ~20s behind the freshest position frame so the dots can be
   * interpolated smoothly, and the client sends that playback instant back as `asOf`. The
   * free-feed path already honours it (getF1LiveState's `infoUptoMs`), but the relay was
   * always answering with live "now" — so in the token environment the sectors and
   * mini-sector bars ran ~20s AHEAD of the car they belong to, which is exactly the
   * "sectors and driver tracker aren't in sync" symptom. Keeping a short history lets the
   * relay answer for the same instant the dots are showing.
   */
  let sectorHistory: { t: number; byDriver: Record<string, SectorTime[]> }[] = [];
  // When the race's own LapCount first reached TotalLaps (the chequered flag, from real lap
  // data — not a schedule guess). SessionStatus/ArchiveStatus can lag well behind the actual
  // flag (podium/post-race coverage keeps the session "Started" for a while) — this is a more
  // direct signal for "is the race actually over" than waiting on those.
  let raceLapsCompleteAt: number | null = null;
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
      sessionStartedTs = null;
      segmentStartedTs = null;
      sessionFinishedTs = null;
      statusHistory = [];
      lastSectors = {};
      sectorHistory = [];
      raceLapsCompleteAt = null;
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
          // Throttle/brake arrive as 104 when a car has NO live telemetry (measured on every
          // stationary car in the pits, alongside rpm/speed/gear all 0, while a car actually
          // running reports a real 0-100). Clamping that to 100 made a parked car read
          // "THROTTLE 100%". Anything above 100 is the no-data sentinel, not a reading.
          const thr = ch?.["4"] ?? 0;
          if (ch) c[num] = [ch["0"] ?? 0, ch["2"] ?? 0, ch["3"] ?? 0, thr > 100 ? 0 : thr];
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
      const d = data as {
        Series?: Record<string, { Utc?: string; QualifyingPart?: number }>;
        StatusSeries?: Record<string, { Utc?: string; SessionStatus?: string }> | { Utc?: string; SessionStatus?: string }[];
      };
      for (const v of Object.values(d.Series ?? {})) {
        if (v.QualifyingPart != null) {
          qualifyingPart = v.QualifyingPart;
          const startMs = v.Utc ? Date.parse(v.Utc) : Date.now();
          qualifyingPartHistory.push({ startMs, part: v.QualifyingPart });
        }
      }
      const statusEntries = Array.isArray(d.StatusSeries) ? d.StatusSeries : Object.values(d.StatusSeries ?? {});
      for (const st of statusEntries) {
        if (!st.SessionStatus) continue;
        const ts = st.Utc ? Date.parse(st.Utc) : Date.now();
        if (!Number.isFinite(ts)) continue;
        if (!statusHistory.some((h) => h.ts === ts && h.status === st.SessionStatus)) {
          statusHistory.push({ ts, status: st.SessionStatus });
          statusHistory.sort((a, b) => a.ts - b.ts);
        }
        if (st.SessionStatus === "Started") {
          if (sessionStartedTs === null) sessionStartedTs = ts; // first only — lights out
          if (segmentStartedTs === null || ts > segmentStartedTs) segmentStartedTs = ts;
        }
        // F1 stamps the real end instant here. Everything else that tracks "when did this
        // end" (endedAt, raceLapsCompleteAt) records when THIS PROCESS first noticed, which
        // restarts on every fresh connection — useless for "how long ago did it finish".
        if (st.SessionStatus === "Finished" && (sessionFinishedTs === null || ts > sessionFinishedTs)) {
          sessionFinishedTs = ts;
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

  /**
   * `tokenOverride` lets a visitor's own token be used instead of the site's F1_TV_TOKEN —
   * everything else about the connection is identical either way.
   *
   * With NO token at all, this connects ANONYMOUSLY, but only for sessions created with
   * `allowAnonymous` (the site's own singleton — never the per-visitor path, where a token
   * failing to authenticate must stay distinguishable from no token being sent).
   *
   * Measured, not assumed — an A-B Subscribe against the SAME session, once anonymous and
   * once with a token, showed exactly two topics differing: Position.z and CarData.z are
   * empty anonymously and populated with a token. Everything else (DriverList, TimingData,
   * TimingAppData, SessionInfo, SessionStatus, SessionData, RaceControlMessages, TrackStatus)
   * is byte-for-byte identical either way. LapCount and ChampionshipPrediction were empty in
   * BOTH — they're populated by session type (race/sprint), not withheld by auth, so don't
   * mistake their absence on a practice session for gating.
   *
   * That covers the timing board, tyres, race control and results — all of which the
   * tokenless deployment previously had to source from F1's free STATIC feed, which
   * publishes its archive hours late (it had no Dutch GP data at all while FP1's results
   * were already complete on the hub).
   */
  async function ensureConnection(tokenOverride?: string): Promise<boolean> {
    const token = tokenOverride ?? process.env.F1_TV_TOKEN?.trim();
    if (!token && !opts.allowAnonymous) return false;
    if (conn && conn.state === signalR.HubConnectionState.Connected) return true;
    if (starting) {
      await starting.catch(() => {});
      return conn?.state === signalR.HubConnectionState.Connected;
    }
    starting = (async () => {
      const c = new signalR.HubConnectionBuilder()
        .withUrl(HUB, {
          ...(token ? { accessTokenFactory: () => token } : {}),
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
      anonymous = !token;
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

  /**
   * When the CURRENT qualifying segment actually began running.
   *
   * F1 publishes `SessionData.Series[].QualifyingPart` while the session is still being SET
   * UP, well before the lights go green — at Zandvoort's Sprint Qualifying, part 1 was
   * announced at 14:16:31Z but the session only started at 14:30:00Z. Counting the segment
   * clock from the announcement burned ~13 min of a 12 min segment before a car had moved,
   * so a freshly-started SQ1 displayed "2:32 left".
   *
   * The green light for the current segment (`StatusSeries` → `SessionStatus: "Started"`,
   * tracked as `segmentStartedTs` — qualifying emits one per segment) is the real start.
   * Take whichever of the two is later: that fixes an early announcement, and degrades to
   * the announcement alone if a session never publishes a per-segment "Started".
   */
  /**
   * Length of the most recent gap between one segment ending and the next going green,
   * measured from this session's own transitions — so Q1->Q2 teaches Q2->Q3 instead of
   * trusting a hardcoded constant across every event.
   *
   * Must scan FORWARD to the next "Started" rather than requiring it to be the immediately
   * following entry: F1 emits an "Inactive" between the two (measured at Zandvoort —
   * Finished 14:18:00, Inactive 14:24:05, Started 14:25:00). Pairing only on adjacency meant
   * this never matched and the estimate silently never self-corrected.
   */
  function measuredBreakMs(): number | null {
    let found: number | null = null;
    for (let i = 0; i < statusHistory.length; i++) {
      if (statusHistory[i].status !== "Finished") continue;
      const next = statusHistory.slice(i + 1).find((h) => h.status === "Started");
      if (!next) continue;
      const observed = next.ts - statusHistory[i].ts;
      if (observed > 60_000 && observed < 30 * 60_000) found = observed; // sanity-bounded
    }
    return found;
  }

  function qualiSegmentStart(): number {
    const announced = qualifyingPartHistory.at(-1)!.startMs;
    return segmentStartedTs != null ? Math.max(announced, segmentStartedTs) : announced;
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
    // Race: the chequered flag is when LapCount's CurrentLap first reaches TotalLaps — a
    // direct signal from real lap data, not a guess. SessionStatus/ArchiveStatus can lag well
    // behind that (podium/post-race coverage keeps the session "Started" a while longer), so
    // trust the lap count first: 20 min after the laps are actually done, call it over,
    // regardless of what SessionStatus still says.
    if (modeOf(sessionInfo.Type) === "race" && lapCount?.TotalLaps && (lapCount.CurrentLap ?? 0) >= lapCount.TotalLaps) {
      if (raceLapsCompleteAt === null) raceLapsCompleteAt = Date.now();
      if (Date.now() > raceLapsCompleteAt + 20 * 60_000) {
        if (sawLive && endedAt == null) endedAt = raceLapsCompleteAt;
        return false;
      }
    } else {
      raceLapsCompleteAt = null; // not (yet) at the final lap — e.g. resumed after a red flag
    }
    // Qualifying (and Sprint Qualifying) run as Q1/Q2/Q3 segments inside ONE session, and
    // F1's SessionStatus topic flips to "Finished" at the end of EACH segment — a short gap
    // before the next one starts, not the session actually ending. Confirmed directly against
    // the live feed (SessionStatus:"Finished" mid-session while SessionInfo still showed
    // Type:"Qualifying" with almost an hour left on the scheduled window) — treating every
    // "Finished" as final made the whole app drop to idle during a normal Q2→Q3 break. Trust
    // the session's own scheduled end time over that transient status while still within it.
    const isMultiSegment = (sessionInfo.Type ?? "").toLowerCase().includes("qualifying");
    // `sessionStartedTs != null` matters: this override only exists to hold a session "live"
    // through the gaps BETWEEN segments. Without that guard it also fired before the session
    // had begun — the hub publishes the next Qualifying's SessionInfo well ahead of time, so
    // the whole app reported a not-yet-started quali as live from the moment it appeared.
    if (isMultiSegment && sessionInfo.EndDate && sessionStartedTs != null) {
      const endMs = Date.parse(sessionInfo.EndDate + "Z") - offsetMs(sessionInfo.GmtOffset);
      if (Number.isFinite(endMs) && Date.now() < endMs) {
        endedAt = null;
        sawLive = true;
        return true;
      }
    }
    if (sessionInfo.ArchiveStatus?.Status === "Complete" || ENDED.has(status)) {
      // Prefer F1's OWN "Finished" timestamp. Date.now() here records when this process
      // noticed, which on a fresh connection (every serverless invocation) fakes a "just
      // ended" no matter how long ago it really was — that's what kept the post-session
      // windows from ever expiring. Falling back to now() only when we watched it run
      // keeps the old behaviour for a feed that never publishes the timestamp.
      if (endedAt == null) endedAt = sessionFinishedTs ?? (sawLive ? Date.now() : null);
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

  /**
   * A session that has FINISHED but is still the one F1's hub is serving — i.e. the final
   * classification is real, current, and worth showing rather than throwing away.
   *
   * Previously `getRelayState()` returned null once `liveOrGrace()` lapsed (2 min past the
   * flag), so the whole Driver Live Tracker collapsed to "no live session" while F1 still had
   * the complete final result — the result flashed up for two minutes and vanished.
   *
   * Bounded by `SHOW_FINISHED_MAX_MS` rather than by the hub advancing to the next session:
   * the gap between sessions is often hours, which left a finished Sprint parked in the live
   * area 40 min after the flag, reading as though it were still running.
   */
  function finishedButCurrent(): boolean {
    // Gate on liveNow(), NOT liveOrGrace(): once F1 says the session is over we want the
    // board labelled FINAL immediately, rather than spending the grace window still showing
    // a red LIVE badge on a finished race and only then switching.
    if (liveNow()) return false;
    if (!sessionInfo) return false;
    // Decided from the DATA, never from whether THIS process happened to watch the session
    // run. On serverless every request can land on a freshly-started instance that connected
    // long after the flag — gating on a `sawLive` flag meant the final classification showed
    // only on the one instance that had been up the whole time, i.e. essentially never in
    // production. F1's own status is what makes it final.
    const status = (sessionStatus?.Status ?? "").toLowerCase();
    const archive = (sessionInfo.ArchiveStatus?.Status ?? "").toLowerCase();
    // ArchiveStatus "Generating" is NOT proof a session is over — F1 reports it on an
    // UPCOMING session too (measured on the Zandvoort qualifying an hour before it started,
    // alongside SessionStatus "Inactive" and an empty StatusSeries). Treating it as finished
    // made a session that hadn't started yet render a "FINAL" board. Require a real end:
    // F1's own Finished transition, an explicitly ended status, or a completed archive.
    if (sessionFinishedTs == null && !ENDED.has(status) && archive !== "complete") return false;
    // Anchor on when it actually ended so a hub parked on an old session can't pin a stale
    // result on screen indefinitely. EndDate is the fallback for a fresh process that has no
    // observed end instant of its own.
    // F1's own "Finished" timestamp FIRST — endedAt/raceLapsCompleteAt are both stamped with
    // Date.now() at the moment this process noticed, so on a fresh connection they read as
    // "just ended" no matter how long ago it really was, and the window never expired.
    const endMs =
      sessionFinishedTs ??
      endedAt ??
      raceLapsCompleteAt ??
      (sessionInfo.EndDate ? Date.parse(sessionInfo.EndDate + "Z") - offsetMs(sessionInfo.GmtOffset) : null);
    // The anchor must be in the PAST. EndDate is the last-resort fallback and is a FUTURE
    // time for a session that hasn't run yet — without this guard that read as "ended
    // moments ago" and kept a not-yet-started session on screen as a final result.
    if (endMs == null || endMs > Date.now()) return false;
    return Date.now() < endMs + SHOW_FINISHED_MAX_MS;
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
        Sectors?: {
          Value?: string;
          PreviousValue?: string;
          OverallFastest?: boolean;
          PersonalFastest?: boolean;
          Segments?: { Status?: number }[];
        }[];
        Speeds?: Record<string, { Value?: string; OverallFastest?: boolean; PersonalFastest?: boolean }>;
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
        // Per-sector timings straight from TimingData — ungated, so these work without a
        // token too. `Value` empties out while a sector is being run and `PreviousValue`
        // holds the last completed one, so fall back to it rather than flashing blank.
        sectors: asList<{
          Value?: string;
          PreviousValue?: string;
          OverallFastest?: boolean;
          PersonalFastest?: boolean;
          Segments?: unknown;
        }>(t.Sectors, 3).map((sec, si) => {
          const live = sec?.Value || sec?.PreviousValue || "";
          const remembered = lastSectors[n]?.[si];
          if (live) {
            (lastSectors[n] ??= [])[si] = {
              value: live,
              overallFastest: Boolean(sec?.OverallFastest),
              personalFastest: Boolean(sec?.PersonalFastest),
            };
          }
          const shown = live ? lastSectors[n][si] : remembered;
          return {
            value: shown?.value ?? "",
            overallFastest: shown?.overallFastest ?? false,
            personalFastest: shown?.personalFastest ?? false,
            // Segments always reflect the CURRENT lap in progress — that's the point of the
            // mini-sector bars — so they're never carried over.
            // Read straight from the accumulated state. deepMerge already folds each sparse
            // delta into the stored Sectors[].Segments, so this is complete WITHOUT keeping a
            // second memory of our own — and crucially it resets when F1 resets it at the
            // start of a new lap. An earlier attempt to stop the bars flashing by merging
            // into a remembered set carried the PREVIOUS lap's mini-sectors into the new one,
            // so a driver who had just started a lap appeared almost through sector 1.
            segments: asList<{ Status?: number }>(sec?.Segments).map((g) => Number(g?.Status ?? 0)),
          };
        }),
        speeds: Object.fromEntries(
          Object.entries(t.Speeds ?? {}).map(([k, v]) => [
            k,
            { value: v?.Value ?? "", overallFastest: Boolean(v?.OverallFastest), personalFastest: Boolean(v?.PersonalFastest) },
          ]),
        ),
      };
      if (best != null && best < fastestMs && t.BestLapTime?.Value) {
        fastestMs = best;
        fastestLap = { driver_number: +n, tla: drivers[n]?.Tla ?? String(n), time: t.BestLapTime.Value, lap: Number(t.BestLapTime.Lap ?? 0) };
      }
    }
    const order = nums.map(Number).sort((a, b) => {
      if (mode === "race") return rows[a].position - rows[b].position;
      const ba = rows[a].best ?? Infinity;
      const bb = rows[b].best ?? Infinity;
      // Two drivers with no time yet both map to Infinity, and Infinity - Infinity is NaN —
      // a comparator returning NaN leaves the sort in engine-defined (effectively arbitrary)
      // order. That's the WHOLE grid for the first minutes of any practice/quali session, so
      // the board opened scrambled rather than in track order. Break ties on position.
      if (ba === bb) return rows[a].position - rows[b].position;
      return ba - bb;
    });
    return { nums, mode, rows, order, fastestLap };
  }

  async function getRelayState(asOfMs?: number): Promise<F1LiveState | null> {
    if (!(await ensureConnection())) return null;
    await refreshIfStale();
    // Live, OR finished-but-still-the-hub's-current-session (final classification stays up
    // instead of the whole tracker vanishing 2 min after the flag).
    const ended = finishedButCurrent();
    if (!sessionInfo || (!liveOrGrace() && !ended)) return null;

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

    // Qualifying segment clock. Three states, in order:
    //   running  -> remainingMs counts down inside the segment
    //   ended    -> its clock hit zero; F1 hasn't started the next one yet (the ~7 min break)
    //   next-in  -> estimated countdown to the next segment's green light, during that break
    // `nextInMs` is an ESTIMATE (see QUALI_BREAK_MS); it's only shown during the break and is
    // replaced by the real clock the instant F1 starts the segment, so it can't drift.
    const qualiClock = (() => {
      const none = { remainingMs: null as number | null, segmentEnded: false, nextInMs: null as number | null, part: qualifyingPart };
      if (!qualifyingPart || !qualifyingPartHistory.length) return none;
      // F1 announces QualifyingPart 1 BEFORE the session starts — measured 13:46:45 for a
      // 14:00 qualifying, 13 min early. With no "Started" yet there is no running segment at
      // all, and counting from the announcement had Q1's 18 min clock already down to 7:21
      // three minutes before the session began. Show the segment chip, but no clock, until
      // F1 actually goes green.
      // Has the CURRENTLY-ANNOUNCED part actually gone green? F1 announces the next part
      // during the break (Q2 announced ~1 min before its green light), so qualifyingPart
      // flips early. Comparing the last "Started" against this part's announcement is what
      // distinguishes "Q2 is running" from "Q2 is announced but we're still in the break" —
      // without it the board read "Q2 ENDED" during the Q1->Q2 gap.
      const announcedAt = qualifyingPartHistory.at(-1)!.startMs;
      const partHasStarted = segmentStartedTs != null && segmentStartedTs >= announcedAt;
      if (!partHasStarted) {
        // Nothing has run yet at all (pre-session) — no clock, no "ended".
        if (qualifyingPart <= 1 && segmentStartedTs == null) return none;
        // Otherwise the PREVIOUS part just ended and we're counting down to this one.
        const prevEnd = [...statusHistory].reverse().find((h) => h.status === "Finished")?.ts ?? null;
        const brk = measuredBreakMs() ?? QUALI_BREAK_MS;
        const until = prevEnd != null ? prevEnd + brk - Date.now() : null;
        return {
          remainingMs: 0,
          segmentEnded: true,
          nextInMs: until != null && until > 0 ? until : null,
          part: Math.max(1, qualifyingPart - 1),
        };
      }
      const now = Date.now();
      const segStart = qualiSegmentStart();

      // Is the CURRENT segment over? Answered by F1's own transitions where possible — a
      // "Finished" later than the last "Started" means we're in the break — and only falling
      // back to the assumed duration when the feed hasn't said so yet. That matters because
      // a red-flagged or extended segment doesn't respect the assumed 12/10/8 at all.
      const lastStarted = [...statusHistory].reverse().find((h) => h.status === "Started")?.ts ?? null;
      const lastFinished = [...statusHistory].reverse().find((h) => h.status === "Finished")?.ts ?? null;
      const finishedPerFeed = lastFinished != null && (lastStarted == null || lastFinished > lastStarted);
      const assumedEndsAt = segStart + qualiSegmentMs(qualifyingPart, sessionInfo.Name);
      const segEndedAt = finishedPerFeed ? lastFinished! : assumedEndsAt;

      if (!finishedPerFeed && now < assumedEndsAt) {
        return { remainingMs: assumedEndsAt - now, segmentEnded: false, nextInMs: null as number | null, part: qualifyingPart };
      }
      if (qualifyingPart >= QUALI_LAST_PART) return { remainingMs: 0, segmentEnded: true, nextInMs: null as number | null, part: qualifyingPart };

      // Break length: MEASURED from this same session's earlier Finished -> Started
      // transition when one has already happened (Q1->Q2 teaches us Q2->Q3), falling back to
      // the value measured at Zandvoort only for the first break of a session. Self-correcting
      // rather than trusting one hardcoded number across every event.
      const breakMs = measuredBreakMs() ?? QUALI_BREAK_MS;
      const untilNext = segEndedAt + breakMs - now;
      return { remainingMs: 0, segmentEnded: true, nextInMs: untilNext > 0 ? untilNext : null, part: qualifyingPart };
    })();

    // Record this instant's sectors, then serve whichever snapshot matches the client's
    // playback clock. Without an `asOf` (any non-map consumer) the newest is used, so this
    // is a no-op for them.
    {
      const snapshot: Record<string, SectorTime[]> = {};
      for (const n of nums) snapshot[n] = rows[+n].sectors;
      const now = Date.now();
      if (!sectorHistory.length || now - sectorHistory[sectorHistory.length - 1].t > 200) {
        sectorHistory.push({ t: now, byDriver: snapshot });
        const cutoff = now - BUFFER_MS;
        if (sectorHistory.length > 20 && sectorHistory[0].t < cutoff) {
          sectorHistory = sectorHistory.filter((h) => h.t >= cutoff);
        }
      }
      // NOTE: history is recorded but deliberately NOT rewound to `asOfMs`. Mini-sectors are
      // the one field that should land the instant F1 reports them — delaying them to the
      // map's playback clock made them visibly trail the car on track. The buffer is kept so
      // this can be revisited without re-plumbing anything.
      void asOfMs;
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
      qualifyingPart: qualiClock.part ?? qualifyingPart,
      qualifyingRemainingMs: qualiClock.remainingMs,
      qualifyingSegmentEnded: qualiClock.segmentEnded,
      nextQualifyingSegmentInMs: qualiClock.nextInMs,
      // Two different situations, because the green light is known at different times.
      // REPLAY-style (the whole session already loaded): sessionStartedTs is known up front,
      // so the formation lap is simply "before it".
      // LIVE: the "Started" event HASN'T HAPPENED YET during the formation lap — that's the
      // whole point of it — so sessionStartedTs is still null and `now < sessionStartedTs`
      // could never once be true. Live formation lap is instead "a race is running, cars are
      // on their lap, and no green light has arrived": LapCount is published (CurrentLap 1)
      // while SessionStatus is still Inactive. Measured during the Zandvoort Sprint at
      // 10:01:52Z — LapCount {CurrentLap:1,TotalLaps:24}, SessionStatus "Inactive", and no
      // "Started" anywhere in StatusSeries.
      formationLap:
        !ended &&
        mode === "race" &&
        (sessionStartedTs != null
          ? Date.now() < sessionStartedTs
          : Number(lapCount?.CurrentLap ?? 0) >= 1),
      mapAvailable: !anonymous,
      sessionEnded: ended,
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
    // The doc above says "main Grand Prix only" — enforce it. A SPRINT arrives with
    // Type "Race" (Name "Sprint"), so a type check alone treats Saturday's sprint as the
    // Grand Prix and flips the hero to the NEXT round while qualifying and the actual race
    // are still to come that weekend. Confirmed against the feed: Zandvoort's sprint reported
    // Name "Sprint", Type "Race", Meeting "Dutch Grand Prix".
    const name = (sessionInfo.Name ?? "").toLowerCase();
    const isGrandPrixRace = (sessionInfo.Type ?? "").toLowerCase() === "race" && !name.includes("sprint");
    if (!isGrandPrixRace || endedAt == null) return null;
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

/* --------------------------- the site's persistent singleton --------------------------- */
// One shared connection for the lifetime of the server process. Uses the site's own
// F1_TV_TOKEN when it's set (full data, unchanged), and falls back to an ANONYMOUS
// connection when it isn't — which still serves timing/tyres/race control/results in real
// time, instead of the hours-late static archive the tokenless deploy used to be stuck with.
const ownerSession = createRelaySession({ allowAnonymous: true });
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
