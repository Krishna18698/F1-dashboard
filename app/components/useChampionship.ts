"use client";

import { useEffect, useState } from "react";

export interface Championship {
  available: boolean;
  round?: number;
  driverPoints?: Record<string, number>; // by driver TLA
  constructorPoints?: Record<string, number>; // by team name
}

/**
 * The live championship projection (instant points during/after a session).
 *
 * ONE poll for the whole page, shared by the Drivers' and Constructors' tables — each used to
 * run its own timer, so the same projection was fetched twice. Same pattern as useLiveStatus:
 * a module-level store, a set of subscribers, no calls while the tab is hidden and an
 * immediate one on return.
 */
let current: Championship | null = null;
const subscribers = new Set<(c: Championship) => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;

// Only meaningful during/after a live session: poll slowly when there's nothing to show.
const intervalMs = (c: Championship | null) => (c?.available ? 20_000 : 60_000);

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(run, intervalMs(current));
}

async function run() {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return schedule();
  if (inFlight) return schedule();
  inFlight = true;
  try {
    // Bounded, so one stalled request can't hold the guard and stop every later poll.
    const res = await fetch("/api/championship", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const d = (await res.json()) as Championship;
    current = d;
    for (const fn of subscribers) fn(d);
  } catch {
    // Keep the last good answer.
  }
  inFlight = false;
  if (subscribers.size) schedule();
}

function onVisible() {
  if (document.visibilityState !== "hidden") run();
}

export function useChampionship(): Championship {
  const [c, setC] = useState<Championship>(() => current ?? { available: false });

  useEffect(() => {
    subscribers.add(setC);
    const isFirst = subscribers.size === 1;
    if (isFirst) document.addEventListener("visibilitychange", onVisible);
    // Deferred to a timer callback: both branches end in setState, which must not run
    // synchronously during the effect.
    const kick = setTimeout(() => {
      if (current) setC(current);
      if (isFirst) run();
    }, 0);
    return () => {
      clearTimeout(kick);
      subscribers.delete(setC);
      if (subscribers.size === 0) {
        if (timer) clearTimeout(timer);
        timer = null;
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
  }, []);

  return c;
}
