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

export interface LiveStatusData {
  live: boolean;
  name?: string;
  type?: string;
  endedAt?: number; // epoch ms the current session ended
  round?: number;
  /** Official start (epoch ms) per session name ("Qualifying"…), when F1's own sources have one:
   *  a Race Control announcement for the current session, else F1's session index. Jolpica's
   *  schedule never changes once published, so a delayed session kept its old countdown. */
  starts?: Record<string, number>;
}

let startsCache: { at: number; value: Record<string, number> } | null = null;
async function indexStarts(): Promise<Record<string, number>> {
  if (startsCache && Date.now() - startsCache.at < 60_000) return startsCache.value;
  const value = await officialSessionStarts().catch(() => ({}) as Record<string, number>);
  startsCache = { at: Date.now(), value };
  return value;
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
  const [status, starts] = await Promise.all([liveStatusOnly(), indexStarts()]);
  const merged = { ...starts, ...manualStarts(starts) };
  const a = (status as { announcedStart?: { label: string; ms: number } }).announcedStart;
  if (a) merged[a.label] = a.ms;
  return Object.keys(merged).length ? { ...status, starts: merged } : status;
}

async function liveStatusOnly(): Promise<LiveStatusData & { announcedStart?: { label: string; ms: number } }> {
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
