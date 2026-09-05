"use client";

import { useEffect, useState } from "react";
import type { LiveStatusData } from "@/lib/live/liveStatus";

export type LiveStatus = LiveStatusData;

/**
 * Whether a session is on track right now — shared by the hero's SessionSchedule and the
 * WeekendSchedule below it.
 *
 * ONE poll for the whole page. Each caller used to run its own `usePolling` timer, so the two
 * components on screen made two identical requests: 430 `/api/livestatus` hits in a sitting,
 * arriving in pairs 1-2 ms apart in the dev log. They were never out of step with each other
 * (measured: 0 ms between the two DOM flips), so this changes nothing visible — it just stops
 * paying twice for the same answer, which on serverless is twice the invocations.
 *
 * Pass `initial` (from the server's own `getLiveStatusData()`, computed in the request that
 * rendered the page) so the first client render already reflects reality instead of flashing
 * "not live" until the first fetch lands.
 */
let current: LiveStatus | null = null;
const subscribers = new Set<(s: LiveStatus) => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;

/** Fast while live (to catch the flag/flip), relaxed when nothing is on track. */
const intervalMs = (s: LiveStatus | null) => (s?.live || s?.endedAt ? 15_000 : 30_000);

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(run, intervalMs(current));
}

async function run() {
  // A backgrounded tab makes zero network calls (keeps a public deploy cheap); the
  // visibilitychange handler fires an immediate catch-up on refocus.
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return schedule();
  if (inFlight) return schedule();
  inFlight = true;
  try {
    const d = (await (await fetch("/api/livestatus", { cache: "no-store" })).json()) as LiveStatus;
    current = d;
    for (const fn of subscribers) fn(d);
  } catch {
    // Keep the last good answer rather than dropping the page to "not live" on one bad fetch.
  }
  inFlight = false;
  schedule();
}

function onVisible() {
  if (document.visibilityState !== "hidden") run();
}

export function useLiveStatus(initial?: LiveStatus): LiveStatus {
  const [s, setS] = useState<LiveStatus>(() => current ?? initial ?? { live: false });

  useEffect(() => {
    subscribers.add(setS);
    const isFirst = subscribers.size === 1;
    if (isFirst) document.addEventListener("visibilitychange", onVisible);
    // Deferred to a timer callback rather than run in the effect body — same idiom as
    // MyTokenCard and TimingBoard's useCountdown. Both the adopt-current and the first fetch
    // end in setState, which must not happen synchronously during the effect.
    const kick = setTimeout(() => {
      // A component mounting later adopts whatever the shared poll already knows, rather than
      // sitting on its own `initial` until the next tick.
      if (current) setS(current);
      if (isFirst) run();
    }, 0);
    return () => {
      clearTimeout(kick);
      subscribers.delete(setS);
      if (subscribers.size === 0) {
        if (timer) clearTimeout(timer);
        timer = null;
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
  }, []);

  return s;
}
