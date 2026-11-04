"use client";

import { useEffect, useState } from "react";

const CHECK_MS = 60_000;

/**
 * Offers a refresh once a newer deployment is live, so an open tab can pick up fixes without
 * the visitor having to know one shipped. It used to reload the page by itself, which could
 * throw away a replay in progress or the driver being followed mid-session — now the visitor
 * chooses when. Checks every minute while the tab is visible (a background tab makes no
 * calls) and straight away when it comes back into view.
 */
export default function VersionWatcher() {
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    let loaded: string | null | undefined;
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const r = await fetch("/api/version", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
        if (!r.ok) return;
        const { version } = (await r.json()) as { version: string | null };
        if (loaded === undefined) loaded = version;
        else if (version && loaded && version !== loaded) setUpdateReady(true);
      } catch {
        // Offline or mid-deploy: try again on the next tick.
      } finally {
        busy = false;
      }
    };
    void check();
    const id = setInterval(check, CHECK_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!updateReady) return null;
  return (
    <div
      role="status"
      className="carbon-bg fixed bottom-3 left-3 z-40 flex items-center gap-3 rounded-full py-1.5 pl-3.5 pr-1.5 text-xs text-white shadow-xl ring-1 ring-white/15"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-red" aria-hidden />
      Update available
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-full bg-red px-3 py-1 font-semibold text-white hover:bg-red/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        Refresh
      </button>
    </div>
  );
}
