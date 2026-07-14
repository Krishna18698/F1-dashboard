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
  const accent = expired ? "#e10600" : "#f5c518";
  const code = "rounded bg-white/10 px-1.5 py-0.5 font-mono text-[0.68rem] text-white/85";
  return (
    <div className="reveal-banner carbon-bg relative mb-6 flex items-center gap-4 overflow-hidden rounded-xl py-4 pl-5 pr-4 ring-1 ring-white/10 sm:gap-5 sm:pl-6">
      {/* Racing stripe */}
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: accent }} />
      {/* soft glow bleeding from the stripe */}
      <span
        className="pointer-events-none absolute inset-y-0 left-0 w-40"
        style={{ background: `linear-gradient(90deg, ${accent}26, transparent)` }}
      />

      {/* Icon badge */}
      <div
        className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full ring-2"
        style={{ color: accent, backgroundColor: `${accent}1a`, borderColor: accent, ["--tw-ring-color" as string]: `${accent}55` }}
      >
        {expired ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5.5 w-5.5">
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" strokeLinejoin="round" />
            <path d="M12 9v4M12 17h.01" strokeLinecap="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5.5 w-5.5">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7.5V12l3 2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>

      {/* Message */}
      <div className="relative min-w-0 flex-1">
        <span className="eyebrow text-[0.6rem]" style={{ color: accent }}>
          F1 TV Token
        </span>
        <p className="font-display text-lg leading-tight text-white sm:text-xl">
          {expired ? (
            <>
              Token has <span className="italic text-red">expired</span>
            </>
          ) : (
            <>
              Token <span className="italic" style={{ color: accent }}>expiring soon</span>
            </>
          )}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-white/55">
          {expired ? "Live tracking is off — " : "Live tracking will stop when it runs out — "}
          refresh <code className={code}>subscriptionToken</code> from the <code className={code}>login-session</code>{" "}
          cookie into <code className={code}>.env.local</code>.
        </p>
      </div>

      {/* Time chip — mirrors the hero countdown cells */}
      <div className="relative hidden shrink-0 flex-col items-center rounded-md bg-white/10 px-4 py-2.5 ring-1 ring-white/15 sm:flex">
        {expired ? (
          <>
            <span className="tnum font-mono text-2xl font-bold leading-none text-red">0:00</span>
            <span className="eyebrow mt-1.5 text-[0.55rem] text-red">Offline</span>
          </>
        ) : (
          <>
            <span className="tnum font-mono text-2xl font-bold leading-none text-white">{remaining}</span>
            <span className="eyebrow mt-1.5 text-[0.55rem] text-white/55">hrs : min</span>
          </>
        )}
      </div>
    </div>
  );
}
