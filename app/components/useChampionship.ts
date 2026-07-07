"use client";

import { useState } from "react";
import { usePolling } from "./usePolling";

export interface Championship {
  available: boolean;
  round?: number;
  driverPoints?: Record<string, number>; // by driver TLA
  constructorPoints?: Record<string, number>; // by team name
}

/** Polls the live championship projection (instant points during/after a session). */
export function useChampionship(): Championship {
  const [c, setC] = useState<Championship>({ available: false });
  // Only meaningful during/after a live session → poll slowly when there's nothing to show.
  usePolling(async () => {
    try {
      const d = (await (await fetch("/api/championship", { cache: "no-store" })).json()) as Championship;
      setC(d);
    } catch {}
  }, c.available ? 20_000 : 60_000);
  return c;
}
