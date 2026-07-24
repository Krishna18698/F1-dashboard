import { getLiveStatus } from "@/lib/f1Relay";
import { resolveLiveSession } from "@/lib/f1feed";
import { currentlyLiveWeekendSession, getNextRace } from "@/lib/jolpica";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/** Whether a session is on track right now, and which one — for the hero + schedule. */
export async function GET() {
  try {
    if (process.env.F1_TV_TOKEN?.trim()) {
      return Response.json(await getLiveStatus());
    }

    // No token — without this, the hero/weekend schedule had no way to know a session was
    // live at all, and marked it "done" the instant its scheduled start time passed. Free
    // feed first (real published data), else Jolpica's own schedule as a schedule-only
    // estimate (F1's live-timing index can lag a session actually starting by hours, or not
    // list the meeting yet at all).
    const live = await resolveLiveSession();
    if (live) {
      return Response.json({ live: true, name: live.name, type: live.type });
    }
    const race = await getNextRace();
    const activeSession = race ? currentlyLiveWeekendSession(race) : null;
    if (race && activeSession) {
      return Response.json({
        live: true,
        name: `${race.raceName} · ${activeSession.label}`,
        type: activeSession.short === "Race" ? "Race" : activeSession.short,
        round: Number(race.round),
      });
    }
    return Response.json({ live: false });
  } catch {
    return Response.json({ live: false });
  }
}
