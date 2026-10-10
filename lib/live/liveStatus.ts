/**
 * Whether a session is on track right now, and which one — shared by the server-rendered
 * initial paint (Hero/WeekendSchedule, so there's no flash from "not live" to "live" while
 * the client's first /api/livestatus poll is in flight) and the API route the client then
 * polls afterwards.
 */
import { liveSocketStatus } from "./liveSocket";
import { liveArchiveSession } from "./liveArchive";
import { currentlyLiveWeekendSession, getNextRace } from "../jolpica";
import { officialSessionStarts } from "../archive/archiveParser";
import { F1_LIVE } from "./liveConfig";
import { fiaTimetableStarts } from "../fiaTimetable";
import { PRE_START_LIVE_MS } from "../sessionWindows";

export interface LiveStatusData {
  live: boolean;
  name?: string;
  type?: string;
  endedAt?: number; // epoch ms the current session ended
  round?: number;
  /** Official start (epoch ms) per session name ("Qualifying"…): a Race Control announcement
   *  for the current session, else liveConfig's override, the FIA timetable, or F1's session
   *  index. Jolpica's schedule never changes once published, so a delayed session kept its old
   *  countdown. */
  starts?: Record<string, number>;
}

let startsCache: { at: number; value: Awaited<ReturnType<typeof officialSessionStarts>> } | null = null;
async function indexStarts() {
  if (startsCache && Date.now() - startsCache.at < 60_000) return startsCache.value;
  const value = await officialSessionStarts().catch(() => ({ starts: {}, gmtOffsetMs: null }));
  startsCache = { at: Date.now(), value };
  return value;
}

// The FIA timetable is a PDF on a slow site: refreshed every 5 min in the background, and a
// cold start waits for it at most FIA_WAIT_MS so the status never stalls behind it.
const FIA_TTL_MS = 5 * 60_000;
const FIA_WAIT_MS = 4000;
let fiaCache: { at: number; value: Record<string, string> } | null = null;
let fiaPending: Promise<void> | null = null;
// A function, so TypeScript re-reads the cache after the await instead of keeping its narrowing.
const cachedFia = () => fiaCache?.value ?? {};
async function fiaStarts(): Promise<Record<string, string>> {
  if ((!fiaCache || Date.now() - fiaCache.at > FIA_TTL_MS) && !fiaPending) {
    fiaPending = fiaTimetableStarts()
      .then((value) => void (fiaCache = { at: Date.now(), value }))
      .catch(() => void (fiaCache = { at: Date.now(), value: fiaCache?.value ?? {} }))
      .finally(() => (fiaPending = null));
  }
  if (fiaCache) return fiaCache.value;
  const timeout = new Promise<void>((r) => setTimeout(r, FIA_WAIT_MS));
  await Promise.race([fiaPending, timeout]);
  return cachedFia();
}

/** Largest move the FIA timetable may make from F1's index — anything more is another meeting. */
const FIA_MAX_SHIFT_MS = 12 * 3600_000;

/** FIA timetable starts (local wall time) as epoch ms, for sessions F1's index also lists. */
function fiaEpochStarts(fia: Record<string, string>, index: Record<string, number>, gmtOffsetMs: number | null) {
  const out: Record<string, number> = {};
  if (gmtOffsetMs == null) return out;
  for (const [name, local] of Object.entries(fia)) {
    const ms = Date.parse(local + ":00Z") - gmtOffsetMs;
    if (Number.isFinite(ms) && index[name] != null && Math.abs(ms - index[name]) <= FIA_MAX_SHIFT_MS) out[name] = ms;
  }
  return out;
}

/** `F1_LIVE.startOverrides` still pending: F1's index has the old time, or no time yet. */
function manualStarts(index: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of F1_LIVE.startOverrides) {
    const was = Date.parse(o.was);
    if (index[o.session] == null || index[o.session] === was) out[o.session] = Date.parse(o.start);
  }
  return out;
}

export async function getLiveStatusData(): Promise<LiveStatusData> {
  const [{ notStarted, announcedStart, ...status }, { starts: index, gmtOffsetMs }, fia] = await Promise.all([
    liveStatusOnly(),
    indexStarts(),
    fiaStarts(),
  ]);
  // Most trusted last: F1's index, then the FIA's timetable (re-issued the moment a session
  // moves, while the index can lag for hours), a hand-set liveConfig entry, and finally a time
  // Race Control has announced for the session about to start.
  const merged = { ...index, ...fiaEpochStarts(fia, index, gmtOffsetMs), ...manualStarts(index) };
  if (announcedStart) merged[announcedStart.label] = announcedStart.ms;
  // F1 opens a delayed session on its feed at the old time; hold "live" until the new one.
  const start = notStarted ? merged[notStarted] : undefined;
  if (status.live && start != null && Date.now() < start - PRE_START_LIVE_MS) status.live = false;
  return Object.keys(merged).length ? { ...status, starts: merged } : status;
}

async function liveStatusOnly(): Promise<
  LiveStatusData & { announcedStart?: { label: string; ms: number }; notStarted?: string }
> {
  try {
    // The socket knows the REAL session status (F1's own SessionStatus/ArchiveStatus), and now
    // works without a token too — so it's tried first either way. `name` being set means it
    // actually connected and knows which session this is; a bare {live:false} means it
    // couldn't connect, which is the only case worth falling through for.
    const socket = await liveSocketStatus();
    if (socket.name) return socket;

    // Socket unreachable — free feed (real published data), else Jolpica's own schedule as a
    // schedule-only estimate (F1's live-timing index can lag a session actually starting by
    // hours, or not list the meeting yet at all).
    const live = await liveArchiveSession();
    if (live) {
      return { live: true, name: live.name, type: live.type };
    }
    const race = await getNextRace();
    const activeSession = race ? currentlyLiveWeekendSession(race) : null;
    if (race && activeSession) {
      return {
        live: true,
        name: `${race.raceName} · ${activeSession.label}`,
        type: activeSession.short === "Race" ? "Race" : activeSession.short,
        round: Number(race.round),
      };
    }
    return { live: false };
  } catch {
    return { live: false };
  }
}
