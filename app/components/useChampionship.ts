"use client";

import { useEffect, useState } from "react";

export interface Championship {
  available: boolean;
  round?: number;
  driverPoints?: Record<string, number>; // by driver TLA
  constructorPoints?: Record<string, number>; // by team name
}

/** Polls the live championship projection (instant points during/after a session). */
export function useChampionship(): Championship {
  const [c, setC] = useState<Championship>({ available: false });
  useEffect(() => {
    let on = true;
    const poll = async () => {
      try {
        const d = (await (await fetch("/api/championship", { cache: "no-store" })).json()) as Championship;
        if (on) setC(d);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 20000);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, []);
  return c;
}
