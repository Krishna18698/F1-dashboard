"use client";

import { useState } from "react";
import { usePolling } from "./usePolling";

export interface LiveStatus {
  live: boolean;
  name?: string;
  type?: string;
  endedAt?: number; // epoch ms the current session ended
  round?: number;
}

/** Polls whether a session is on track right now (for the hero + weekend schedule). */
export function useLiveStatus(): LiveStatus {
  const [s, setS] = useState<LiveStatus>({ live: false });
  // Fast while live (to catch the flag/flip), relaxed when nothing is on track.
  usePolling(async () => {
    try {
      const d = (await (await fetch("/api/livestatus", { cache: "no-store" })).json()) as LiveStatus;
      setS(d);
    } catch {}
  }, s.live || s.endedAt ? 15_000 : 30_000);
  return s;
}
