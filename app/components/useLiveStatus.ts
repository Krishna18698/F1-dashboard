"use client";

import { useEffect, useState } from "react";

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
  useEffect(() => {
    let on = true;
    const poll = async () => {
      try {
        const d = (await (await fetch("/api/livestatus", { cache: "no-store" })).json()) as LiveStatus;
        if (on) setS(d);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 15000);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, []);
  return s;
}
