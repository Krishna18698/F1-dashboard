"use client";

import { useEffect, useState } from "react";
import { WeekendSession } from "@/lib/jolpica";

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
 * Weekend sessions on the race card: counts down to the next one and names it.
 * Renders a deterministic placeholder until mounted (same on server + client) so
 * there's no hydration mismatch or layout shift; then swaps to live values.
 */
export default function SessionSchedule({ sessions }: { sessions: WeekendSession[] }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const raf = requestAnimationFrame(tick); // first paint after mount, avoids SSR mismatch
    const id = setInterval(tick, 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(id);
    };
  }, []);

  const ready = now !== null;
  const nextIdx = ready ? sessions.findIndex((s) => Date.parse(s.iso) > now!) : -1;
  const next = nextIdx >= 0 ? sessions[nextIdx] : null;
  const t = ready && next ? delta(Date.parse(next.iso) - now!) : null;

  const cells: [string, string][] = [
    ["Days", t ? pad(t.d) : "––"],
    ["Hrs", t ? pad(t.h) : "––"],
    ["Min", t ? pad(t.m) : "––"],
    ["Sec", t ? pad(t.s) : "––"],
  ];

  return (
    <div>
      <p className="eyebrow mb-2 text-[0.65rem] text-white/45">
        {!ready ? "Next session" : next ? `Next · ${next.label} in` : "Race weekend complete"}
      </p>

      {/* Countdown boxes are always rendered (fixed size) → no shift. */}
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

      {/* Weekend chips — neutral until mounted, then done ✓ / next highlighting. */}
      <div className="mt-4 flex flex-wrap gap-1.5 lg:justify-end">
        {sessions.map((sess, i) => {
          const done = ready && Date.parse(sess.iso) <= now! && i !== nextIdx;
          const isNext = ready && i === nextIdx;
          return (
            <span
              key={sess.label}
              title={sess.label}
              className={[
                "rounded px-2 py-1 text-[0.6rem] font-semibold tracking-wide",
                isNext ? "bg-red text-white" : done ? "bg-white/5 text-white/35" : "bg-white/10 text-white/70",
              ].join(" ")}
            >
              {sess.short}
              {/* fixed-width mark slot so the chip never changes size (no reflow) */}
              <span className="ml-0.5 inline-block w-2 text-center">{done ? "✓" : ""}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
