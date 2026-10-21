/**
 * REPLAY from OpenF1, for when F1's own archive is out of reach.
 *
 * Since ~15 Oct 2026 F1 has required an F1 TV login for its whole archive (see
 * archiveParser.archiveHeaders). OpenF1 records the same live feed and serves past sessions
 * free and without a login — except while any session is live, when its free tier refuses
 * everything (openF1LiveLocked).
 *
 * Rather than a second replay engine, this rebuilds the SessionCache that F1's archive used to
 * produce — the same TimingData / TimingAppData / LapCount / TrackStatus / race control deltas
 * — so getF1LiveState derives the board, sectors, tyres, flags and qualifying clock exactly as
 * before. Everything here is OpenF1's data placed on a timeline; nothing is estimated except
 * WHEN a mini-sector lit inside its sector (they appear together as the sector completes) and the
 * practice clock (scheduled length, stopped for a suspension).
 *
 * Car positions and telemetry run to ~1.5 MB per two minutes each, so they are fetched in
 * two-minute chunks around the playback instant (ensureWindow) instead of whole.
 */
import "server-only";
import type { ResolvedSession, SessionCache, Delta, PosFrame, RawDriver, RcMessage } from "./archiveParser";
import { QUALI_DURATION_MS, SPRINT_QUALI_DURATION_MS } from "../sessionWindows";
import { F1_LIVE } from "../live/liveConfig";

const BASE = "https://api.openf1.org/v1";
export const OPENF1_PREFIX = "openf1/";

/* --------------------------------- fetching -------------------------------- */

function auth(): Record<string, string> {
  const key = process.env.OPENF1_API_KEY?.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

// The free tier allows about 3 requests a second and 30 a minute. Space every request out so a
// cold load (nine requests) can never trip it.
const SPACING_MS = 400;
let nextSlot = 0;
async function slot() {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + SPACING_MS;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

/** OpenF1 locks its free tier for the whole of every live session, past sessions included. */
let liveLockedUntil = 0;
export function openF1LiveLocked(): boolean {
  return Date.now() < liveLockedUntil;
}

class OpenF1Unavailable extends Error {}

async function get<T>(path: string): Promise<T[]> {
  if (openF1LiveLocked()) throw new OpenF1Unavailable("live session in progress");
  await slot();
  const res = await fetch(`${BASE}${path}`, { headers: auth(), cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (res.status === 401) {
    const body = await res.text().catch(() => "");
    // {"detail":"Live F1 session in progress. Global API access (including past sessions) is
    // restricted to authenticated users until the session ends."}
    if (/live/i.test(body)) liveLockedUntil = Date.now() + 60_000;
    throw new OpenF1Unavailable(`OpenF1 ${res.status}`);
  }
  // "No results found" is a 404 with a JSON object — an empty answer, not an error.
  if (res.status === 404) return [];
  if (!res.ok) throw new OpenF1Unavailable(`OpenF1 ${res.status}`);
  const body = await res.json();
  return Array.isArray(body) ? (body as T[]) : [];
}

/* ---------------------------------- types ---------------------------------- */

interface OSession {
  session_key: number;
  session_type: string;
  session_name: string;
  date_start: string;
  date_end: string;
  meeting_key: number;
  circuit_key: number;
  location: string;
  gmt_offset: string;
  is_cancelled?: boolean;
}
interface OMeeting {
  meeting_key: number;
  meeting_name: string;
}
interface ODriver {
  driver_number: number;
  name_acronym: string;
  full_name: string;
  team_name: string;
  team_colour: string;
}
interface OLap {
  driver_number: number;
  lap_number: number;
  date_start: string | null;
  lap_duration: number | null;
  duration_sector_1: number | null;
  duration_sector_2: number | null;
  duration_sector_3: number | null;
  segments_sector_1: (number | null)[] | null;
  segments_sector_2: (number | null)[] | null;
  segments_sector_3: (number | null)[] | null;
  i1_speed: number | null;
  i2_speed: number | null;
  st_speed: number | null;
  is_pit_out_lap: boolean | null;
}
interface OStint {
  driver_number: number;
  stint_number: number;
  lap_start: number | null;
  lap_end: number | null;
  compound: string | null;
  tyre_age_at_start: number | null;
}
interface OPit {
  driver_number: number;
  date: string;
  lap_number: number;
  lane_duration: number | null;
}
interface ORc {
  date: string;
  driver_number: number | null;
  lap_number: number | null;
  category: string;
  flag: string | null;
  scope: string | null;
  sector: number | null;
  qualifying_phase: number | null;
  message: string;
}
interface OPosition {
  date: string;
  driver_number: number;
  position: number;
}
interface OInterval {
  date: string;
  driver_number: number;
  gap_to_leader: number | string | null;
  interval: number | string | null;
}
interface OResult {
  driver_number: number;
  dnf?: boolean;
  duration?: number | (number | null)[] | null;
}
interface OLocation {
  date: string;
  driver_number: number;
  x: number;
  y: number;
}
interface OCarData {
  date: string;
  driver_number: number;
  rpm: number | null;
  speed: number | null;
  n_gear: number | null;
  throttle: number | null;
}

/* -------------------------------- candidates -------------------------------- */

let sessionsCache: { at: number; value: ResolvedSession[] } | null = null;

/** Completed sessions of this season, newest first, the preferred type first — the same order
 *  archiveParser.fallbackCandidates gives F1's own archive. */
export async function openF1Candidates(): Promise<ResolvedSession[]> {
  if (sessionsCache && Date.now() - sessionsCache.at < 10 * 60_000) return sessionsCache.value;
  const year = new Date().getUTCFullYear();
  const [sessions, meetings] = [await get<OSession>(`/sessions?year=${year}`), await get<OMeeting>(`/meetings?year=${year}`)];
  const meetingName = new Map(meetings.map((m) => [m.meeting_key, m.meeting_name]));
  const now = Date.now();
  // A few minutes' grace after the scheduled end: OpenF1 publishes as the session runs, but a
  // session still in progress would replay with no ending.
  const past = sessions
    .filter((s) => !s.is_cancelled && Date.parse(s.date_end) + 10 * 60_000 <= now)
    .sort((a, b) => Date.parse(b.date_start) - Date.parse(a.date_start));
  const toResolved = (s: OSession): ResolvedSession => ({
    path: `${OPENF1_PREFIX}${s.session_key}/${s.session_name.replace(/\s+/g, "_")}`,
    type: s.session_type,
    name: `${meetingName.get(s.meeting_key) ?? s.location} · ${s.session_name}`,
    location: s.location,
    live: false,
    circuitKey: s.circuit_key,
  });
  const preferred = past.filter((s) => s.session_type === F1_LIVE.preferType);
  const rest = past.filter((s) => s.session_type !== F1_LIVE.preferType);
  const value = [...preferred, ...rest].slice(0, 5).map(toResolved);
  sessionsCache = { at: Date.now(), value };
  return value;
}

/* -------------------------------- formatting -------------------------------- */

const ms = (iso: string) => Date.parse(iso);

/** "1:31.496" — the shape F1's own LastLapTime/BestLapTime values take. */
function fmtLap(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m > 0 ? `${m}:${s.toFixed(3).padStart(6, "0")}` : s.toFixed(3);
}

/** OpenF1 gaps are seconds (number) or already-formatted strings ("+1 LAP"). */
function fmtGap(v: number | string | null): string {
  if (v == null) return "";
  if (typeof v === "number") return `+${v.toFixed(3)}`;
  return v;
}

/* ---------------------------------- loader ---------------------------------- */

/** Before the green light: the replay anchors 3 min before it (formation lap), so keep room. */
const LEAD_MS = 15 * 60_000;
const CHUNK_MS = 120_000;
const MAX_CHUNKS = 6;
const FRAME_STEP_MS = 250;

export async function loadOpenF1Session(path: string): Promise<SessionCache> {
  const key = Number(path.slice(OPENF1_PREFIX.length).split("/")[0]);
  const [session] = await get<OSession>(`/sessions?session_key=${key}`);
  if (!session) throw new OpenF1Unavailable(`no OpenF1 session ${key}`);
  const q = `?session_key=${key}`;
  // Sequential on purpose: `get` spaces requests for the rate limit anyway.
  const drivers = await get<ODriver>(`/drivers${q}`);
  const laps = await get<OLap>(`/laps${q}`);
  const stints = await get<OStint>(`/stints${q}`);
  const pits = await get<OPit>(`/pit${q}`);
  const rcRaw = await get<ORc>(`/race_control${q}`);
  const positions = await get<OPosition>(`/position${q}`);
  const isRace = session.session_type === "Race";
  const intervals = isRace ? await get<OInterval>(`/intervals${q}`) : [];
  const results = await get<OResult>(`/session_result${q}`);

  rcRaw.sort((a, b) => ms(a.date) - ms(b.date));
  const statusMsgs = rcRaw.filter((r) => r.category === "SessionStatus");
  const firstStart = statusMsgs.find((r) => /STARTED/i.test(r.message));
  const T0 = (firstStart ? ms(firstStart.date) : ms(session.date_start)) - LEAD_MS;
  const rel = (iso: string) => ms(iso) - T0;

  const isQuali = session.session_type === "Qualifying";
  const isSprint = /sprint/i.test(session.session_name);

  /* drivers */
  const driverMap: Record<string, RawDriver> = {};
  for (const d of drivers) {
    driverMap[String(d.driver_number)] = {
      RacingNumber: String(d.driver_number),
      Tla: d.name_acronym,
      FullName: d.full_name,
      TeamName: d.team_name,
      TeamColour: (d.team_colour ?? "").replace(/^#/, ""),
    };
  }

  /* session status, qualifying segments, the clock */
  const statusHist: { ts: number; status: string }[] = [];
  const qp: { ts: number; part: number }[] = [];
  for (const r of statusMsgs) {
    const ts = rel(r.date);
    const m = r.message.toUpperCase();
    const status = /STARTED|RESUMED/.test(m) ? "Started" : /FINISHED/.test(m) ? "Finished" : /SUSPENDED|ABORTED/.test(m) ? "Aborted" : null;
    if (!status) continue;
    statusHist.push({ ts, status });
    if (isQuali && status === "Started" && r.qualifying_phase && qp.at(-1)?.part !== r.qualifying_phase) {
      qp.push({ ts, part: r.qualifying_phase });
    }
  }
  const sessionStartedTs = statusHist.find((h) => h.status === "Started")?.ts ?? null;

  // F1's clock stops for a suspension and starts again where it was. Practice runs its scheduled
  // length; each qualifying segment its regulation length. Race: no clock (laps count instead).
  const clockHist: { ts: number; remainingMs: number; running: boolean }[] = [];
  if (!isRace) {
    const segLen = isSprint ? SPRINT_QUALI_DURATION_MS : QUALI_DURATION_MS;
    let remaining = 0;
    let runningSince: number | null = null;
    let part = 0;
    for (const h of statusHist) {
      if (runningSince != null) remaining = Math.max(0, remaining - (h.ts - runningSince));
      if (h.status === "Started") {
        const p = isQuali ? (qp.filter((x) => x.ts <= h.ts).at(-1)?.part ?? 1) : 1;
        if (p !== part) {
          part = p;
          remaining = isQuali ? (segLen[p] ?? 0) : ms(session.date_end) - ms(session.date_start);
        }
        runningSince = h.ts;
        clockHist.push({ ts: h.ts, remainingMs: remaining, running: true });
      } else {
        runningSince = null;
        if (h.status === "Finished") remaining = 0;
        clockHist.push({ ts: h.ts, remainingMs: remaining, running: false });
      }
    }
  }

  /* timing deltas */
  const events: { ts: number; num: string; upd: Record<string, unknown> }[] = [];
  const push = (ts: number, num: number | string, upd: Record<string, unknown>) => {
    if (Number.isFinite(ts)) events.push({ ts, num: String(num), upd });
  };

  for (const p of positions) push(rel(p.date), p.driver_number, { Position: String(p.position), Line: p.position });
  for (const iv of intervals) {
    push(rel(iv.date), iv.driver_number, {
      GapToLeader: fmtGap(iv.gap_to_leader),
      IntervalToPositionAhead: { Value: fmtGap(iv.interval) },
    });
  }

  // Practice and qualifying start with every car in the garage.
  if (!isRace) for (const n of Object.keys(driverMap)) push(0, n, { InPit: true });
  for (const p of pits) {
    const exit = rel(p.date);
    if (p.lane_duration != null) push(exit - p.lane_duration * 1000, p.driver_number, { InPit: true, PitOut: false });
    push(exit, p.driver_number, { InPit: false, PitOut: true });
    push(exit + 10_000, p.driver_number, { PitOut: false });
  }

  // Laps that race control deleted (track limits) never count as a best, from the moment the
  // deletion is announced: "CAR 87 (BEA) TIME 1:40.294 DELETED - TRACK LIMITS …".
  const deletions: { ts: number; num: string; time: string }[] = [];
  for (const r of rcRaw) {
    const m = /CAR (\d+).*?TIME (\d+:\d{2}\.\d{3}|\d{2}\.\d{3}) DELETED/i.exec(r.message);
    if (m) deletions.push({ ts: rel(r.date), num: m[1], time: m[2] });
  }

  const segmentOf = (ts: number) => (isQuali ? (qp.filter((p) => p.ts <= ts).at(-1)?.part ?? 1) : 1);
  const lapsBy = new Map<string, OLap[]>();
  for (const l of laps) {
    const k = String(l.driver_number);
    if (!lapsBy.has(k)) lapsBy.set(k, []);
    lapsBy.get(k)!.push(l);
  }

  // Sector completions across the whole field, in time order, so personal and overall bests are
  // flagged as F1 flags them: against everything set before that instant.
  const sectorDone: { ts: number; num: string; si: number; sec: number; segs: (number | null)[] }[] = [];
  const lapEnds: { ts: number; num: string; lap: number; sec: number | null; part: number }[] = [];

  for (const [num, list] of lapsBy) {
    list.sort((a, b) => a.lap_number - b.lap_number);
    for (let i = 0; i < list.length; i++) {
      const l = list[i];
      const start = l.date_start ? rel(l.date_start) : null;
      if (start == null) continue;
      const segsOf = [l.segments_sector_1, l.segments_sector_2, l.segments_sector_3];
      // The line: every mini-sector blanks (what getF1LiveState reads as a lap reset).
      const reset: Record<string, unknown> = {};
      segsOf.forEach((segs, si) => {
        const n = segs?.length ?? 8;
        reset[String(si)] = { Segments: Object.fromEntries(Array.from({ length: n }, (_, gi) => [String(gi), { Status: 0 }])) };
      });
      push(start, num, { Sectors: reset });
      const durs = [l.duration_sector_1, l.duration_sector_2, l.duration_sector_3];
      // The three sector times can sum to a hair more than the lap, which would land S3 just
      // after the next lap's line crossing — on the NEW lap, beside its S1 (seen: ANT, Q3).
      const next = list[i + 1]?.date_start ? rel(list[i + 1].date_start!) : Infinity;
      let t = start;
      for (let si = 0; si < 3; si++) {
        const d = durs[si];
        if (d == null) break;
        t += d * 1000;
        sectorDone.push({ ts: Math.min(t, next - 1), num, si, sec: d, segs: segsOf[si] ?? [] });
      }
      const speeds: Record<string, unknown> = {};
      if (l.i1_speed) speeds.I1 = { Value: String(l.i1_speed) };
      if (l.i2_speed) speeds.I2 = { Value: String(l.i2_speed) };
      if (l.st_speed) speeds.ST = { Value: String(l.st_speed) };
      if (Object.keys(speeds).length) push(start + (l.lap_duration ?? 60) * 1000, num, { Speeds: speeds });
      // Lap complete: its own duration, or (no duration — an in-lap) the next lap's start.
      const end = l.lap_duration != null ? start + l.lap_duration * 1000 : list[i + 1]?.date_start ? rel(list[i + 1].date_start!) : null;
      if (end != null) lapEnds.push({ ts: end, num, lap: l.lap_number, sec: l.lap_duration, part: segmentOf(start) });
    }
  }

  sectorDone.sort((a, b) => a.ts - b.ts);
  const personal: Record<string, number[]> = {};
  const overall: number[] = [];
  for (const s of sectorDone) {
    const pb = (personal[s.num] ??= [])[s.si];
    const isPb = pb == null || s.sec < pb;
    if (isPb) personal[s.num][s.si] = s.sec;
    const isOverall = overall[s.si] == null || s.sec < overall[s.si];
    if (isOverall) overall[s.si] = s.sec;
    const segments: Record<string, { Status: number }> = {};
    s.segs.forEach((c, gi) => {
      if (c != null) segments[String(gi)] = { Status: c };
    });
    push(s.ts, s.num, {
      Sectors: { [String(s.si)]: { Value: s.sec.toFixed(3), PersonalFastest: isPb, OverallFastest: isOverall, Segments: segments } },
    });
  }

  // Lap counts, last laps and bests (per segment in qualifying, as F1 keeps them).
  lapEnds.sort((a, b) => a.ts - b.ts);
  const segStarts = qp.map((p) => p.ts);
  const doneBy: Record<string, { ts: number; lap: number; sec: number; part: number }[]> = {};
  const bestOf = (num: string, asOf: number, part: number) => {
    let best: { lap: number; sec: number } | null = null;
    for (const l of doneBy[num] ?? []) {
      if (l.ts > asOf || l.part !== part) continue;
      const time = fmtLap(l.sec);
      if (deletions.some((d) => d.num === num && d.time === time && d.ts <= asOf)) continue;
      if (!best || l.sec < best.sec) best = { lap: l.lap, sec: l.sec };
    }
    return best;
  };
  const bestUpd = (num: string, asOf: number) => {
    const part = segmentOf(asOf);
    const best = bestOf(num, asOf, part);
    const upd: Record<string, unknown> = { BestLapTime: best ? { Value: fmtLap(best.sec), Lap: best.lap } : { Value: "", Lap: 0 } };
    if (isQuali) upd.BestLapTimes = { [String(part - 1)]: best ? { Value: fmtLap(best.sec), Lap: best.lap } : {} };
    return upd;
  };
  for (const e of lapEnds) {
    const upd: Record<string, unknown> = { NumberOfLaps: e.lap };
    if (e.sec != null) {
      upd.LastLapTime = { Value: fmtLap(e.sec) };
      (doneBy[e.num] ??= []).push({ ts: e.ts, lap: e.lap, sec: e.sec, part: e.part });
      Object.assign(upd, bestUpd(e.num, e.ts));
    }
    push(e.ts, e.num, upd);
  }
  for (const d of deletions) push(d.ts, d.num, bestUpd(d.num, d.ts));
  // A new qualifying segment starts everyone's best afresh; the previous one stays in BestLapTimes.
  if (isQuali) for (const ts of segStarts.slice(1)) for (const n of Object.keys(driverMap)) push(ts, n, { BestLapTime: { Value: "", Lap: 0 } });

  // Knocked out of qualifying: the result lists a time for each segment a driver took part in.
  if (isQuali) {
    const finishedAt = statusHist.filter((h) => h.status === "Finished").map((h) => h.ts);
    for (const r of results) {
      const d = Array.isArray(r.duration) ? r.duration : [];
      // No time at all (HAD, Singapore 2026) is out after Q1 like anyone slowest.
      const ran = Math.max(1, d.filter((v) => v != null).length);
      if (ran < 3 && finishedAt[ran - 1] != null) push(finishedAt[ran - 1], r.driver_number, { KnockedOut: true });
    }
  }
  // Retired from a race: from the end of the last lap they completed.
  if (isRace) {
    for (const r of results) {
      if (!r.dnf) continue;
      const last = lapEnds.filter((e) => e.num === String(r.driver_number)).at(-1);
      if (last) push(last.ts + 5_000, r.driver_number, { Retired: true });
    }
  }

  events.sort((a, b) => a.ts - b.ts);
  const timing: Delta[] = [];
  for (const e of events) {
    const last = timing.at(-1);
    if (last && last.ts === e.ts) {
      const cur = (last.lines[e.num] ??= {}) as Record<string, unknown>;
      mergeInto(cur, e.upd);
    } else {
      timing.push({ ts: e.ts, lines: { [e.num]: structuredClone(e.upd) } });
    }
  }

  /* tyres */
  const lapStartOf = (num: string, lap: number) => {
    const l = lapsBy.get(num)?.find((x) => x.lap_number === lap);
    return l?.date_start ? rel(l.date_start) : null;
  };
  const appEvents: { ts: number; num: string; upd: Record<string, unknown> }[] = [];
  for (const s of stints) {
    const num = String(s.driver_number);
    const startLap = s.lap_start ?? 1;
    // A race's first set is on the car on the grid, before the replay opens; elsewhere a set
    // appears when the car goes out on it.
    const at = isRace && s.stint_number === 1 ? 0 : (lapStartOf(num, startLap) ?? (startLap === 1 ? sessionStartedTs : null));
    if (at == null) continue;
    const age = s.tyre_age_at_start ?? 0;
    const idx = String(s.stint_number - 1);
    const stint = { Compound: (s.compound ?? "UNKNOWN").toUpperCase(), New: String(age === 0), StartLaps: age, TotalLaps: age };
    appEvents.push({ ts: at, num, upd: { Stints: { [idx]: stint } } });
    for (const e of lapEnds) {
      if (e.num !== num || e.lap < startLap || (s.lap_end != null && e.lap > s.lap_end)) continue;
      appEvents.push({ ts: e.ts, num, upd: { Stints: { [idx]: { TotalLaps: age + (e.lap - startLap + 1) } } } });
    }
  }
  if (isRace) {
    // The first running order is the grid.
    const seen = new Set<string>();
    for (const p of [...positions].sort((a, b) => ms(a.date) - ms(b.date))) {
      const n = String(p.driver_number);
      if (seen.has(n)) continue;
      seen.add(n);
      appEvents.push({ ts: 0, num: n, upd: { GridPos: String(p.position) } });
    }
  }
  appEvents.sort((a, b) => a.ts - b.ts);
  const app: Delta[] = appEvents.map((e) => ({ ts: e.ts, lines: { [e.num]: e.upd } }));

  /* lap counter (races) */
  const lap: { ts: number; data: Record<string, unknown> }[] = [];
  if (isRace) {
    const totalLaps = Math.max(0, ...laps.map((l) => l.lap_number));
    lap.push({ ts: 0, data: { CurrentLap: 1, TotalLaps: totalLaps } });
    const firstStartOfLap = new Map<number, number>();
    for (const l of laps) {
      if (!l.date_start) continue;
      const t = rel(l.date_start);
      const cur = firstStartOfLap.get(l.lap_number);
      if (cur == null || t < cur) firstStartOfLap.set(l.lap_number, t);
    }
    for (const [n, t] of [...firstStartOfLap.entries()].sort((a, b) => a[1] - b[1])) lap.push({ ts: t, data: { CurrentLap: n } });
  }

  /* race control and track status */
  const rc: { ts: number; idx: string; msg: RcMessage }[] = [];
  const track: { ts: number; status: string }[] = [{ ts: 0, status: "1" }];
  let neutral: "4" | "5" | "6" | "7" | null = null;
  const yellow = new Set<number>();
  const setTrack = (ts: number) => {
    const status = neutral ?? (yellow.size ? "2" : "1");
    if (track.at(-1)?.status !== status) track.push({ ts, status });
  };
  rcRaw.forEach((r, i) => {
    const ts = rel(r.date);
    const m = r.message.toUpperCase();
    if (r.category === "SessionStatus") {
      if (/SUSPENDED|ABORTED/.test(m)) neutral = "5";
      setTrack(ts);
      return; // not a race control message in F1's own feed
    }
    const msg: RcMessage = {
      Utc: r.date.slice(0, 19),
      Category: r.category,
      Message: r.message,
      ...(r.flag ? { Flag: r.flag } : {}),
      ...(r.scope ? { Scope: r.scope } : {}),
      ...(r.sector != null ? { Sector: r.sector } : {}),
      ...(r.driver_number != null ? { RacingNumber: String(r.driver_number) } : {}),
      ...(r.lap_number != null ? { Lap: r.lap_number } : {}),
    };
    if (r.category === "SafetyCar") {
      const vsc = /VSC|VIRTUAL/.test(m);
      msg.Mode = vsc ? "VIRTUAL SAFETY CAR" : "SAFETY CAR";
      msg.Status = /ENDING/.test(m) ? "ENDING" : /IN THIS LAP/.test(m) ? "IN THIS LAP" : "DEPLOYED";
      if (/DEPLOYED/.test(m)) neutral = vsc ? "6" : "4";
      else if (vsc && /ENDING/.test(m)) neutral = "7";
    }
    if (r.flag === "RED") neutral = "5";
    if (r.scope === "Sector" && r.sector != null) {
      if (r.flag === "YELLOW" || r.flag === "DOUBLE YELLOW") yellow.add(r.sector);
      else if (r.flag === "CLEAR") yellow.delete(r.sector);
    }
    if (r.scope === "Track" && (r.flag === "GREEN" || r.flag === "CLEAR")) {
      neutral = null;
      yellow.clear();
    }
    setTrack(ts);
    rc.push({ ts, idx: String(i), msg });
  });

  const lastTs = Math.max(timing.at(-1)?.ts ?? 0, statusHist.at(-1)?.ts ?? 0);
  const durationMs = lastTs + 3 * 60_000;

  const entry: SessionCache = {
    loadedAt: Date.now(),
    drivers: driverMap,
    timing,
    app,
    lap,
    track,
    rc,
    qp,
    gmtOffset: session.gmt_offset ?? null,
    sessionStartedTs,
    statusHist,
    clockHist,
    car: [],
    posOffset: T0,
    frames: [],
    durationMs,
    tel: [],
  };
  entry.ensureWindow = windowLoader(entry, key, T0, durationMs);
  return entry;
}

function mergeInto(target: Record<string, unknown>, src: Record<string, unknown>) {
  for (const [k, v] of Object.entries(src)) {
    const cur = target[k];
    if (v && typeof v === "object" && !Array.isArray(v) && cur && typeof cur === "object" && !Array.isArray(cur)) {
      mergeInto(cur as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      target[k] = structuredClone(v);
    }
  }
}

/* ------------------------------ position window ------------------------------ */

type TelFrame = { t: number; c: Record<string, [number, number, number, number]> };

/** Loads car positions and telemetry in two-minute chunks as the playback reaches them, keeping
 *  the most recent few. Each chunk is two requests. */
function windowLoader(entry: SessionCache, key: number, T0: number, durationMs: number) {
  const chunks = new Map<number, { frames: PosFrame[]; tel: TelFrame[]; used: number }>();
  const pending = new Map<number, Promise<void>>();

  const loadChunk = async (idx: number) => {
    const from = new Date(T0 + idx * CHUNK_MS - 2000).toISOString();
    const to = new Date(T0 + (idx + 1) * CHUNK_MS + 2000).toISOString();
    const range = `session_key=${key}&date>=${from}&date<${to}`;
    const loc = await get<OLocation>(`/location?${range}`);
    const car = await get<OCarData>(`/car_data?${range}`);
    const lo = idx * CHUNK_MS;
    const hi = (idx + 1) * CHUNK_MS;
    chunks.set(idx, { frames: toFrames(loc, T0, lo, hi), tel: toTel(car, T0, lo, hi), used: Date.now() });
    while (chunks.size > MAX_CHUNKS) {
      const oldest = [...chunks.entries()].sort((a, b) => a[1].used - b[1].used)[0];
      chunks.delete(oldest[0]);
    }
    const ordered = [...chunks.entries()].sort((a, b) => a[0] - b[0]);
    entry.frames = ordered.flatMap(([, c]) => c.frames);
    entry.tel = ordered.flatMap(([, c]) => c.tel);
  };

  return async (fromMs: number, toMs: number) => {
    const first = Math.max(0, Math.floor(fromMs / CHUNK_MS));
    const last = Math.min(Math.floor(durationMs / CHUNK_MS), Math.floor(toMs / CHUNK_MS));
    const waits: Promise<void>[] = [];
    for (let idx = first; idx <= last; idx++) {
      const have = chunks.get(idx);
      if (have) {
        have.used = Date.now();
        continue;
      }
      if (!pending.has(idx)) {
        pending.set(
          idx,
          loadChunk(idx)
            .catch(() => {})
            .finally(() => pending.delete(idx)),
        );
      }
      waits.push(pending.get(idx)!);
    }
    await Promise.all(waits);
  };
}

/** OpenF1 samples each car on its own clock (~4 Hz). The map wants frames holding every car at
 *  one instant, so each car is placed at a common 250 ms step by interpolating between its two
 *  surrounding samples — never across a gap of more than 2 s. */
function toFrames(rows: OLocation[], T0: number, lo: number, hi: number): PosFrame[] {
  const by = new Map<string, { t: number; x: number; y: number }[]>();
  for (const r of rows) {
    if (!r.x && !r.y) continue;
    const k = String(r.driver_number);
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push({ t: Date.parse(r.date) - T0, x: r.x, y: r.y });
  }
  for (const list of by.values()) list.sort((a, b) => a.t - b.t);
  const idx = new Map<string, number>();
  const frames: PosFrame[] = [];
  for (let t = lo; t < hi; t += FRAME_STEP_MS) {
    const cars: Record<string, [number, number]> = {};
    for (const [num, list] of by) {
      let i = idx.get(num) ?? 0;
      while (i + 1 < list.length && list[i + 1].t <= t) i++;
      idx.set(num, i);
      const a = list[i];
      const b = list[i + 1];
      if (!a || a.t > t) continue;
      if (b && b.t - a.t <= 2000) {
        const f = (t - a.t) / (b.t - a.t);
        cars[num] = [Math.round(a.x + (b.x - a.x) * f), Math.round(a.y + (b.y - a.y) * f)];
      } else if (t - a.t <= 500) {
        cars[num] = [a.x, a.y];
      }
    }
    if (Object.keys(cars).length) frames.push({ ts: t, cars });
  }
  return frames;
}

/** Telemetry on the same 250 ms step: each car's latest sample at or before it. Channels are
 *  F1's CarData order — [rpm, speed, gear, throttle]. */
function toTel(rows: OCarData[], T0: number, lo: number, hi: number): TelFrame[] {
  const by = new Map<string, { t: number; v: [number, number, number, number] }[]>();
  for (const r of rows) {
    const k = String(r.driver_number);
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push({ t: Date.parse(r.date) - T0, v: [r.rpm ?? 0, r.speed ?? 0, r.n_gear ?? 0, r.throttle ?? 0] });
  }
  for (const list of by.values()) list.sort((a, b) => a.t - b.t);
  const idx = new Map<string, number>();
  const out: TelFrame[] = [];
  for (let t = lo; t < hi; t += FRAME_STEP_MS) {
    const c: Record<string, [number, number, number, number]> = {};
    for (const [num, list] of by) {
      let i = idx.get(num) ?? -1;
      while (i + 1 < list.length && list[i + 1].t <= t) i++;
      idx.set(num, i);
      const s = list[i];
      if (s && t - s.t <= 1000) c[num] = s.v;
    }
    if (Object.keys(c).length) out.push({ t, c });
  }
  return out;
}

/* ------------------------------ weekend tyres ------------------------------ */

/** Every session of the same meeting, for the weekend tyre allocation (named as F1's archive
 *  names them, "Singapore Grand Prix · Sprint", which is how a sprint weekend is recognised). */
export async function openF1WeekendSessions(path: string): Promise<{ path: string; name: string; startMs: number }[]> {
  const key = Number(path.slice(OPENF1_PREFIX.length).split("/")[0]);
  const [session] = await get<OSession>(`/sessions?session_key=${key}`);
  if (!session) return [];
  const [meeting] = await get<OMeeting>(`/meetings?meeting_key=${session.meeting_key}`);
  const sessions = await get<OSession>(`/sessions?meeting_key=${session.meeting_key}`);
  return sessions.map((s) => ({
    path: `${OPENF1_PREFIX}${s.session_key}/${s.session_name.replace(/\s+/g, "_")}`,
    name: `${meeting?.meeting_name ?? s.location} · ${s.session_name}`,
    startMs: Date.parse(s.date_start),
  }));
}

/** New sets fitted per driver per dry compound in one session: stints that began on 0 laps. */
export async function openF1NewSetCounts(path: string): Promise<Record<string, Record<string, number>>> {
  const key = Number(path.slice(OPENF1_PREFIX.length).split("/")[0]);
  const out: Record<string, Record<string, number>> = {};
  for (const s of await get<OStint>(`/stints?session_key=${key}`)) {
    const compound = (s.compound ?? "").toUpperCase();
    if (s.tyre_age_at_start !== 0 || !["SOFT", "MEDIUM", "HARD"].includes(compound)) continue;
    const bucket = (out[String(s.driver_number)] ??= {});
    bucket[compound] = (bucket[compound] ?? 0) + 1;
  }
  return out;
}
