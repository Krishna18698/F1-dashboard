"use client";

import { useEffect, useState } from "react";
import { WeekendSession } from "@/lib/jolpica";
import { useLiveStatus } from "./useLiveStatus";

const pad = (n: number) => String(n).padStart(2, "0");

function delta(ms: number) {
  ms = Math.max(0, ms);
  return {
    d: Math.floor(ms / 86_400_000),
    h: Math.floor((ms % 86_400_000) / 3_600_000),
    m: Math.floor((ms % 3_600_000) / 60_000),
    s: Math.floor((ms % 60_000) / 1000),
  };
}

/**
 * Hero timing: if a session is live now, show "LIVE" (no timer); otherwise count
 * down to the next session and name it. Renders a stable placeholder until mounted.
 */
export default function SessionSchedule({ sessions }: { sessions: WeekendSession[] }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const raf = requestAnimationFrame(tick);
    const id = setInterval(tick, 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(id);
    };
  }, []);
  const { live, name } = useLiveStatus();

  const ready = now !== null;
  // Identify the live session by the feed's name (e.g. "… · Qualifying") — robust.
  const liveLabel = live && name ? name.split("·").pop()?.trim() : null;
  const liveSession = ready && liveLabel ? (sessions.find((s) => s.label === liveLabel) ?? null) : null;
  const nextIdx = ready ? sessions.findIndex((s) => Date.parse(s.iso) > now!) : -1;
  const next = nextIdx >= 0 ? sessions[nextIdx] : null;
  const t = ready && !liveSession && next ? delta(Date.parse(next.iso) - now!) : null;

  if (liveSession) {
    return (
      <div>
        <p className="eyebrow mb-2 text-[0.65rem] text-white/45">On track now</p>
        <div className="inline-flex items-center gap-2.5 rounded-md bg-red px-4 py-2.5">
          <span className="live-dot h-2.5 w-2.5 rounded-full bg-white" />
          <span className="font-display text-xl italic text-white">
            {liveSession.label} · Live
          </span>
        </div>
      </div>
    );
  }

  const cells: [string, string][] = [
    ["Days", t ? pad(t.d) : "––"],
    ["Hrs", t ? pad(t.h) : "––"],
    ["Min", t ? pad(t.m) : "––"],
    ["Sec", t ? pad(t.s) : "––"],
  ];

  return (
    <div>
      <p className="eyebrow mb-2 text-[0.65rem] text-white/45">
        {!ready ? "Next session" : next ? `Next · ${next.label} in` : "Weekend complete"}
      </p>
      <div className="flex gap-2 sm:gap-3 lg:justify-end">
        {cells.map(([label, val]) => (
          <div
            key={label}
            className="flex min-w-[3.4rem] flex-col items-center rounded-md bg-white/10 px-3 py-2 ring-1 ring-white/15 sm:min-w-16"
          >
            <span className="tnum font-mono text-2xl font-bold leading-none text-white sm:text-3xl">
              {val}
            </span>
            <span className="eyebrow mt-1 text-[0.6rem] text-white/55">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
