"use client";

import { useEffect, useState } from "react";
import { WeekendSession } from "@/lib/jolpica";
import { useLiveStatus } from "./useLiveStatus";

function fmtLocal(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Full weekend schedule in the viewer's local time: done ✓, live 🔴, or upcoming. */
export default function WeekendSchedule({ sessions }: { sessions: WeekendSession[] }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const raf = requestAnimationFrame(tick);
    const id = setInterval(tick, 30000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(id);
    };
  }, []);
  const { live, name } = useLiveStatus();

  const ready = now !== null;
  // The live session is matched by the feed's name (e.g. "… · Qualifying").
  const liveLabel = live && name ? name.split("·").pop()?.trim() : null;
  const nextIdx = ready ? sessions.findIndex((s) => Date.parse(s.iso) > now!) : -1;

  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-2 border-b-2 border-ink pb-2">
        <h3 className="font-display whitespace-nowrap text-xl xl:text-2xl">
          Weekend <span className="italic text-red">Schedule</span>
        </h3>
        <span className="eyebrow shrink-0 text-[0.55rem] text-muted">Your local time</span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {sessions.map((s, i) => {
          const isLive = ready && liveLabel === s.label;
          const done = ready && !isLive && Date.parse(s.iso) <= now!;
          const isNext = !isLive && i === nextIdx;
          const dark = isLive || isNext; // black card like the season calendar's current round
          return (
            <div
              key={s.label}
              className={[
                "rounded-lg border p-3 transition-colors",
                dark
                  ? "carbon-bg border-white/10 text-white"
                  : done
                    ? "border-line bg-panel/60 opacity-70"
                    : "border-line bg-paper",
              ].join(" ")}
            >
              <div className="flex items-center justify-between">
                <span className={`eyebrow text-[0.6rem] ${dark ? "text-white/50" : "text-muted"}`}>
                  {s.short}
                </span>
                {isLive ? (
                  <span className="flex items-center gap-1 text-[0.5rem] font-bold tracking-wide text-white">
                    <span className="live-dot h-1.5 w-1.5 rounded-full bg-red" />
                    LIVE
                  </span>
                ) : isNext ? (
                  <span className="rounded-sm bg-red px-1.5 py-0.5 text-[0.5rem] font-bold tracking-wide text-white">
                    NEXT
                  </span>
                ) : done ? (
                  <span className="text-xs font-bold text-red">✓</span>
                ) : null}
              </div>
              <p className={`mt-1.5 truncate text-sm font-semibold ${dark ? "text-white" : ""}`}>
                {s.label}
              </p>
              <p className={`tnum text-xs ${dark ? "text-white/60" : "text-ink-soft"}`}>
                {ready ? fmtLocal(s.iso) : "—"}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
