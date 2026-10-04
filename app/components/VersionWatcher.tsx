"use client";

import { useEffect } from "react";

const CHECK_MS = 60_000;

/**
 * Reloads the page once a newer deployment is live, so an open tab picks up fixes without a
 * manual refresh. Checks every minute and whenever the tab comes back into view, and only
 * reloads while it's visible — a background tab reloads the moment it's looked at again.
 */
export default function VersionWatcher() {
  useEffect(() => {
    let loaded: string | null | undefined;
    let busy = false;
    const check = async () => {
      if (busy) return;
      busy = true;
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        if (!r.ok) return;
        const { version } = (await r.json()) as { version: string | null };
        if (loaded === undefined) loaded = version;
        else if (version && loaded && version !== loaded && document.visibilityState === "visible") {
          window.location.reload();
        }
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
  return null;
}
