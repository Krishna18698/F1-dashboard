"use client";

import { useEffect, useState } from "react";
import { formatLap, hex } from "@/lib/format";

interface Row {
  pos: number;
  tla: string;
  team_colour: string;
  best: number | null;
  gap: string;
}
interface Res {
  status: string;
  session_name?: string;
  mode?: "race" | "quali" | "practice";
  complete?: boolean;
  endedAtMs?: number;
  top?: Row[];
}

const RESULT_TTL = 24 * 60 * 60 * 1000; // hide the result bar 24h after the session ended
const expired = (d: Res | null) =>
  !!d?.endedAtMs && d.complete !== false && Date.now() > d.endedAtMs + RESULT_TTL;

function Item({ d, isRace }: { d: Row; isRace: boolean }) {
  const value = isRace ? d.gap || "—" : formatLap(d.best);
  return (
    <span className="mx-4 inline-flex shrink-0 items-center gap-2">
      <span className="tnum font-mono text-xs font-bold text-white/40">P{d.pos}</span>
      <span className="h-3 w-1 rounded-full" style={{ backgroundColor: hex(d.team_colour) }} />
      <span className="text-sm font-semibold text-white">{d.tla}</span>
      {value && <span className="tnum font-mono text-xs text-white/55">{value}</span>}
      <span className="ml-2 text-white/20">•</span>
    </span>
  );
}

/** Rolling news-ticker of the latest session's standings on the hero card. */
const CACHE_KEY = "pitwall:lastResult";

export default function SessionResults() {
  const [r, setR] = useState<Res | null>(null);

  useEffect(() => {
    let on = true;
    let hydrated = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      // On first run, show the last known result instantly (persists across reloads).
      if (!hydrated) {
        hydrated = true;
        try {
          const cached = localStorage.getItem(CACHE_KEY);
          if (cached && on) setR(JSON.parse(cached));
        } catch {}
      }
      // Tab hidden → skip the network refresh (cache already shown); re-check soon.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        if (on) timer = setTimeout(poll, 15_000);
        return;
      }
      let complete = true;
      try {
        const d = (await (await fetch("/api/f1results", { cache: "no-store" })).json()) as Res;
        if (!on) return;
        if (d.status === "ok" && d.top?.length) {
          complete = d.complete ?? true;
          setR(d);
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(d));
          } catch {}
        }
        // status "none"/"off" → keep showing the stored result, don't clear.
      } catch {}
      // Live session → refresh often; finished/idle → back off.
      if (on) timer = setTimeout(poll, complete ? 60_000 : 15_000);
    };
    poll();

    return () => {
      on = false;
      clearTimeout(timer);
    };
  }, []);

  // Hidden when there's nothing to show, or 24h after the session ended.
  if (r?.status === "off" || expired(r)) return null;
  // Loading: render the exact same layout, invisible, so height matches → no shift.
  if (!r || !r.top?.length) {
    return (
      <div className="border-t border-white/10 py-3" aria-hidden>
        <div className="mb-2 px-6 sm:px-8">
          <span className="eyebrow inline-block rounded-sm px-2 py-1 text-[0.55rem] font-bold opacity-0">
            —
          </span>
        </div>
        <div className="text-sm opacity-0">·</div>
      </div>
    );
  }
  const isRace = r.mode === "race";
  // Slower for longer grids; one full loop ≈ 2.4s per entry.
  const duration = Math.max(20, r.top.length * 2.4);

  return (
    <div className="border-t border-white/10 py-3">
      {/* Line 1: session · RESULT */}
      <div className="mb-2 px-6 sm:px-8">
        <span
          className={`eyebrow inline-block rounded-sm px-2 py-1 text-[0.55rem] font-bold tracking-wide ${
            r.complete ? "bg-white/15 text-white/75" : "bg-red text-white"
          }`}
        >
          {r.session_name} · {r.complete ? "RESULT" : "LIVE"}
        </span>
      </div>

      {/* Line 2: rolling results (edge-to-edge, fades both sides) */}
      <div className="relative overflow-hidden">
        <div className="ticker-track" style={{ animationDuration: `${duration}s` }}>
          {[0, 1].map((copy) => (
            <span key={copy} className="inline-flex shrink-0" aria-hidden={copy === 1}>
              {r.top!.map((d) => (
                <Item key={`${copy}-${d.pos}-${d.tla}`} d={d} isRace={isRace} />
              ))}
            </span>
          ))}
        </div>
        {/* Soft fade at both edges into the card */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-linear-to-r from-carbon to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-linear-to-l from-carbon to-transparent" />
      </div>
    </div>
  );
}
