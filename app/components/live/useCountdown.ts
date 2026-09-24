"use client";

import { useEffect, useRef, useState } from "react";

/** Ticks a "remaining ms as of the last poll" value down locally in real time, resyncing
 *  whenever a fresh value arrives — same pattern as the hero countdown.
 *
 *  `running: false` holds the figure instead. A stopped clock arrives as the SAME value on
 *  every poll, so the resync never fires and a ticker left running counted the session down
 *  through a red flag (Madrid FP3: F1 held 15:38, the board read 15:25 and falling). */
export function useCountdown(remainingMs: number | null | undefined, running = true): string | null {
  const [display, setDisplay] = useState<number | null>(null);
  const base = useRef<{ ms: number; at: number; running: boolean } | null>(null);

  // Only touch the ref here (refs are exempt from the "no setState during render/effect
  // body" rule) — the interval below is the sole place that ever calls setDisplay, and it
  // does so from a timer callback, not synchronously during the effect's own execution.
  useEffect(() => {
    base.current = remainingMs != null ? { ms: remainingMs, at: Date.now(), running } : null;
  }, [remainingMs, running]);

  useEffect(() => {
    const id = setInterval(() => {
      const b = base.current;
      setDisplay(b ? (b.running ? Math.max(0, b.ms - (Date.now() - b.at)) : b.ms) : null);
    }, 500);
    return () => clearInterval(id);
  }, []);

  if (display == null) return null;
  const totalSec = Math.floor(display / 1000);
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, "0")}`;
}
