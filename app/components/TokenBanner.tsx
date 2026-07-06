"use client";

import { useEffect, useState } from "react";

interface Status {
  present: boolean;
  expired: boolean;
  hoursLeft: number | null;
  expiresAt: string | null;
}

const WARN_HOURS = 24;

/** Warns when the F1 TV token is expired or expiring soon, so live never dies silently. */
export default function TokenBanner() {
  const [s, setS] = useState<Status | null>(null);

  useEffect(() => {
    let on = true;
    const poll = async () => {
      try {
        const d = (await (await fetch("/api/f1token", { cache: "no-store" })).json()) as Status;
        if (on) setS(d);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 10 * 60_000); // re-check every 10 min
    return () => {
      on = false;
      clearInterval(id);
    };
  }, []);

  // No token (running the free feed) or a healthy token → say nothing.
  if (!s || !s.present) return null;
  const soon = s.hoursLeft !== null && s.hoursLeft > 0 && s.hoursLeft < WARN_HOURS;
  if (!s.expired && !soon) return null;

  const expired = s.expired;
  // Remaining time as h:mm (e.g. "20:40"), not decimal hours.
  const totalMin = Math.max(0, Math.round((s.hoursLeft ?? 0) * 60));
  const remaining = `${Math.floor(totalMin / 60)}:${String(totalMin % 60).padStart(2, "0")}`;
  return (
    <div
      className={`mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-4 py-3 text-sm ${
        expired
          ? "border-red bg-red-tint text-ink"
          : "border-amber-400 bg-amber-50 text-ink"
      }`}
    >
      <span className="font-semibold">
        {expired ? "⚠️ F1 TV token expired" : `⏳ F1 TV token expires in ${remaining} (h:mm)`}
      </span>
      <span className="text-ink-soft">
        {expired
          ? "— live tracking is off. "
          : "— live tracking will stop soon. "}
        Re-grab the token from your <code className="rounded bg-black/5 px-1">login-session</code>{" "}
        cookie and update <code className="rounded bg-black/5 px-1">.env.local</code>.
      </span>
    </div>
  );
}
