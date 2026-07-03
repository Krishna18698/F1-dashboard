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
 * Shows the weekend's sessions on the race card, counts down to the *next* one,
 * and names it (FP1 / Sprint Qualifying / Qualifying / Race …).
 */
export default function SessionSchedule({ sessions }: { sessions: WeekendSession[] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const nextIdx = sessions.findIndex((s) => Date.parse(s.iso) > now);
  const next = nextIdx >= 0 ? sessions[nextIdx] : null;
  const t = next ? delta(Date.parse(next.iso) - now) : null;

  const cells: [string, number][] = t
    ? [
        ["Days", t.d],
        ["Hrs", t.h],
        ["Min", t.m],
        ["Sec", t.s],
      ]
    : [];

  return (
    <div>
      <p className="eyebrow mb-2 text-[0.65rem] text-white/45">
        {next ? `Next · ${next.label} in` : "Race weekend complete"}
      </p>

      {t && (
        <div className="flex gap-2 sm:gap-3 lg:justify-end">
          {cells.map(([label, val]) => (
            <div
              key={label}
              className="flex min-w-[3.4rem] flex-col items-center rounded-md bg-white/10 px-3 py-2 ring-1 ring-white/15 sm:min-w-16"
            >
              <span className="tnum font-mono text-2xl font-bold leading-none text-white sm:text-3xl">
                {pad(val)}
              </span>
              <span className="eyebrow mt-1 text-[0.6rem] text-white/55">{label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Weekend session chips: done ✓ · next (red) · upcoming */}
      <div className="mt-4 flex flex-wrap gap-1.5 lg:justify-end">
        {sessions.map((sess, i) => {
          const done = Date.parse(sess.iso) <= now && i !== nextIdx;
          const isNext = i === nextIdx;
          return (
            <span
              key={sess.label}
              title={sess.label}
              className={[
                "rounded px-2 py-1 text-[0.6rem] font-semibold tracking-wide",
                isNext
                  ? "bg-red text-white"
                  : done
                    ? "bg-white/5 text-white/35"
                    : "bg-white/10 text-white/70",
              ].join(" ")}
            >
              {sess.short}
              {done ? " ✓" : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
}
