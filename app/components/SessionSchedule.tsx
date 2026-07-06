"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { WeekendSession } from "@/lib/jolpica";
import { useLiveStatus } from "./useLiveStatus";

const pad = (n: number) => String(n).padStart(2, "0");
const FLIP_MS = 300_000; // "Race ended" holds for 5 min, then flip to the next weekend

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
 * Hero timing: LIVE (no timer) when a session is on track, else countdown to next.
 * Below it, the weekend session chips: completed ✓, next in red, live only when live.
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
  const { live, name, type, endedAt } = useLiveStatus();
  const router = useRouter();

  const ready = now !== null;
  const liveLabel = live && name ? name.split("·").pop()?.trim() : null;
  const liveSession = ready && liveLabel ? (sessions.find((s) => s.label === liveLabel) ?? null) : null;
  const nextIdx = ready ? sessions.findIndex((s) => Date.parse(s.iso) > now!) : -1;
  const next = nextIdx >= 0 ? sessions[nextIdx] : null;

  // Just after the race: show "Race ended" (no timer) for 5 min, then refresh so the
  // server advances the hero/schedule/calendar to the next round.
  const isRace = (type ?? "").toLowerCase() === "race";
  const raceEnded = ready && !live && !!endedAt && isRace && now! < endedAt + FLIP_MS;
  const flipped = useRef<number | null>(null);
  useEffect(() => {
    if (!ready || !endedAt || !isRace) return;
    if (now! >= endedAt + FLIP_MS && flipped.current !== endedAt) {
      flipped.current = endedAt; // fire once per race end — no refresh loop
      router.refresh();
    }
  }, [ready, now, endedAt, isRace, router]);

  const t = ready && !liveSession && !raceEnded && next ? delta(Date.parse(next.iso) - now!) : null;

  const cells: [string, string][] = [
    ["Days", t ? pad(t.d) : "––"],
    ["Hrs", t ? pad(t.h) : "––"],
    ["Min", t ? pad(t.m) : "––"],
    ["Sec", t ? pad(t.s) : "––"],
  ];

  return (
    <div>
      {liveSession ? (
        <>
          <p className="eyebrow mb-2 text-[0.65rem] text-white/45 lg:text-right">On track now</p>
          <div className="inline-flex items-center gap-2.5 rounded-md bg-red px-4 py-2.5">
            <span className="live-dot h-2.5 w-2.5 rounded-full bg-white" />
            <span className="font-display text-xl italic text-white">{liveSession.label} · Live</span>
          </div>
        </>
      ) : raceEnded ? (
        <>
          <p className="eyebrow mb-2 text-[0.65rem] text-white/45 lg:text-right">Just finished</p>
          <div className="inline-flex items-center gap-2.5 rounded-md bg-white/10 px-4 py-2.5 ring-1 ring-white/15">
            <span aria-hidden>🏁</span>
            <span className="font-display text-xl italic text-white">Race ended</span>
          </div>
        </>
      ) : (
        <>
          <p className="eyebrow mb-2 text-[0.65rem] text-white/45 lg:text-right">
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
        </>
      )}

      {/* Weekend session chips: ✓ done · red next · live only when live */}
      <div className="mt-4 flex flex-wrap gap-1.5 lg:justify-end">
        {sessions.map((s, i) => {
          const isLive = ready && liveLabel === s.label;
          const isNext = !isLive && i === nextIdx;
          const done = ready && !isLive && Date.parse(s.iso) <= now!;
          return (
            <span
              key={s.label}
              title={s.label}
              className={[
                "inline-flex items-center gap-1 rounded px-2 py-1 text-[0.6rem] font-semibold tracking-wide",
                isLive || isNext ? "bg-red text-white" : done ? "bg-white/5 text-white/40" : "bg-white/10 text-white/70",
              ].join(" ")}
            >
              {isLive && <span className="live-dot h-1.5 w-1.5 rounded-full bg-white" />}
              {s.short}
              <span className="inline-block w-2 text-center">{done ? "✓" : ""}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
