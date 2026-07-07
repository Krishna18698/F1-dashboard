"use client";

import { useEffect, useRef } from "react";

/**
 * Polls `fn` immediately, then every `intervalMs` — but ONLY while the tab is visible.
 * A backgrounded tab makes zero network calls (keeps a public deploy cheap on serverless
 * invocations); on refocus it fires again right away. Pass a larger `intervalMs` when idle
 * and a small one during a live session to poll fast only when it matters.
 */
export function usePolling(fn: () => void, intervalMs: number) {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn; // keep the latest callback without restarting the interval
  });

  useEffect(() => {
    const tick = () => {
      if (typeof document === "undefined" || document.visibilityState !== "hidden") fnRef.current();
    };
    tick();
    const id = setInterval(tick, intervalMs);
    const onVisible = () => {
      if (document.visibilityState !== "hidden") fnRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs]);
}
