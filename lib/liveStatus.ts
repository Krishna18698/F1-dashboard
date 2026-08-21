/**
 * Whether a session is on track right now, and which one — shared by the server-rendered
 * initial paint (Hero/WeekendSchedule, so there's no flash from "not live" to "live" while
 * the client's first /api/livestatus poll is in flight) and the API route the client then
 * polls afterwards.
 */
import { getLiveStatus } from "./f1Relay";
import { resolveLiveSession } from "./f1feed";
import { currentlyLiveWeekendSession, getNextRace } from "./jolpica";

export interface LiveStatusData {
  live: boolean;
  name?: string;
  type?: string;
  endedAt?: number; // epoch ms the current session ended
  round?: number;
}

export async function getLiveStatusData(): Promise<LiveStatusData> {
  try {
    if (process.env.F1_TV_TOKEN?.trim()) {
      return await getLiveStatus();
    }

    // No token — free feed first (real published data), else Jolpica's own schedule as a
    // schedule-only estimate (F1's live-timing index can lag a session actually starting by
    // hours, or not list the meeting yet at all).
    const live = await resolveLiveSession();
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
