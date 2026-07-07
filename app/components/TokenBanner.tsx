"use client";

import { useState } from "react";
import { usePolling } from "./usePolling";

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

  usePolling(async () => {
    try {
      const d = (await (await fetch("/api/f1token", { cache: "no-store" })).json()) as Status;
      setS(d);
    } catch {}
  }, 10 * 60_000); // re-check every 10 min

  // No token (running the free feed) or a healthy token → say nothing.
  if (!s || !s.present) return null;
  const soon = s.hoursLeft !== null && s.hoursLeft > 0 && s.hoursLeft < WARN_HOURS;
  if (!s.expired && !soon) return null;

  const expired = s.expired;
  // Remaining time as h:mm (e.g. "20:40"), not decimal hours.
  const totalMin = Math.max(0, Math.round((s.hoursLeft ?? 0) * 60));
  const remaining = `${Math.floor(totalMin / 60)}:${String(totalMin % 60).padStart(2, "0")}`;
  const code = "rounded bg-black/5 px-1 font-mono text-[0.7rem] text-ink";
  return (
    <div
      className={`reveal-banner mb-6 flex items-center gap-3.5 rounded-xl border-l-4 py-3.5 pr-4 pl-4 shadow-sm ring-1 sm:gap-4 sm:pl-5 ${
        expired ? "border-l-red bg-red-tint ring-red/15" : "border-l-amber-400 bg-amber-50 ring-amber-200/70"
      }`}
    >
      {/* Icon badge */}
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
          expired ? "bg-red/10 text-red" : "bg-amber-100 text-amber-600"
        }`}
      >
        {expired ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" strokeLinejoin="round" />
            <path d="M12 9v4M12 17h.01" strokeLinecap="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7.5V12l3 2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>

      {/* Message */}
      <div className="min-w-0 flex-1">
        <span className={`eyebrow text-[0.6rem] ${expired ? "text-red" : "text-amber-700"}`}>F1 TV Token</span>
        <p className="font-display text-base leading-tight text-ink sm:text-lg">
          {expired ? "Token has expired" : "Token expiring soon"}
        </p>
        <p className="mt-0.5 text-xs leading-snug text-ink-soft">
          {expired ? "Live tracking is off — " : "Live tracking will stop when it runs out — "}
          refresh <code className={code}>subscriptionToken</code> from the <code className={code}>login-session</code>{" "}
          cookie into <code className={code}>.env.local</code>.
        </p>
      </div>

      {/* Time chip */}
      <div
        className={`hidden shrink-0 flex-col items-center rounded-lg px-3.5 py-1.5 leading-none ring-1 sm:flex ${
          expired ? "bg-red text-white ring-red" : "bg-white text-ink ring-amber-200"
        }`}
      >
        {expired ? (
          <span className="text-sm font-bold tracking-wider">OFFLINE</span>
        ) : (
          <>
            <span className="tnum font-mono text-xl font-bold">{remaining}</span>
            <span className="eyebrow mt-1 text-[0.5rem] text-amber-600">hrs : min</span>
          </>
        )}
      </div>
    </div>
  );
}
