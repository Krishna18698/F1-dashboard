"use client";

import { useState } from "react";
import { usePolling } from "./usePolling";
import type { LiveStatusData } from "@/lib/live/liveStatus";

export type LiveStatus = LiveStatusData;

/**
 * Polls whether a session is on track right now (for the hero + weekend schedule).
 * Pass `initial` (from the server's own `getLiveStatusData()`, computed in the same request
 * that rendered the page) so the very first client render already reflects reality instead
 * of a hardcoded "not live" default — without it, the page flashes "not live" for as long as
 * the first `/api/livestatus` fetch takes before flipping to the real state.
 */
export function useLiveStatus(initial?: LiveStatus): LiveStatus {
  const [s, setS] = useState<LiveStatus>(initial ?? { live: false });
  // Fast while live (to catch the flag/flip), relaxed when nothing is on track.
  usePolling(async () => {
    try {
      const d = (await (await fetch("/api/livestatus", { cache: "no-store" })).json()) as LiveStatus;
      setS(d);
    } catch {}
  }, s.live || s.endedAt ? 15_000 : 30_000);
  return s;
}
