"use client";

import { useEffect, useRef, useState } from "react";
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
  live?: boolean;
  endedAtMs?: number;
  top?: Row[];
}

const RESULT_TTL = 24 * 60 * 60 * 1000; // keep the result bar for 24h after the session ends
// Renderable only if it's a live result, or a completed one dated within the last 24h.
// Anything else renders NOTHING (not a placeholder) → the bar never flashes in and
// collapses out on reload, which was sliding the page.
const showable = (d: Res | null): d is Res & { top: Row[] } =>
  !!d && d.status !== "off" && !!d.top?.length &&
  (d.complete === false || (!!d.endedAtMs && Date.now() <= d.endedAtMs + RESULT_TTL));

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

/**
 * Never replace a result with an older one. The archive tier answers with the most recent
 * session F1 has PUBLISHED, which mid-weekend can be a race from a fortnight ago — that used to
 * overwrite the session actually on screen (and its localStorage copy) with something
 * showable() then refused to draw, blanking the bar. Observed after Italian GP FP1.
 * `>=` rather than `>` so a live session, whose endedAtMs is its fixed scheduled end, still
 * updates itself as laps come in.
 */
const fresher = (next: Res, prev: Res | null) => !prev || (next.endedAtMs ?? 0) >= (prev.endedAtMs ?? 0);

export default function SessionResults() {
  const [r, setR] = useState<Res | null>(null);
  // The poll loop is created once (empty dep array), so reading `r` inside it would always see
  // the first render's value. The ref tracks what is actually on screen.
  const latest = useRef<Res | null>(null);

  useEffect(() => {
    let on = true;
    let hydrated = false;
    let timer: ReturnType<typeof setTimeout>;
    // Guards against the visibilitychange handler below firing while a poll is already in
    // flight and spawning a second, overlapping one (same race useF1Live's poll loop had).
    let inFlight = false;

    const poll = async () => {
      // On first run, show the last known result instantly (persists across reloads).
      if (!hydrated) {
        hydrated = true;
        try {
          const cached = localStorage.getItem(CACHE_KEY);
          if (cached && on) {
            const parsed = JSON.parse(cached) as Res;
            if (showable(parsed)) {
              latest.current = parsed;
              setR(parsed); // don't restore something we won't render
            }
          }
        } catch {}
      }
      // Tab hidden → skip the network refresh (cache already shown); re-check soon.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        if (on) timer = setTimeout(poll, 15_000);
        return;
      }
      if (inFlight) return;
      inFlight = true;
      let complete = true;
      try {
        const d = (await (await fetch("/api/f1results", { cache: "no-store" })).json()) as Res;
        if (!on) return;
        if (d.status === "ok" && d.top?.length) {
          // Poll cadence follows what the server reports even when the result is rejected
          // below, so a live session is still refreshed every 15 s.
          complete = d.complete ?? true;
          // Accept only what we would actually render, and only if it is not older than what
          // is already showing — an "ok" response is not on its own reason to overwrite.
          if (showable(d) && fresher(d, latest.current)) {
            latest.current = d;
            setR(d);
            try {
              localStorage.setItem(CACHE_KEY, JSON.stringify(d));
            } catch {}
          }
        }
        // status "none"/"off" → keep showing the stored result, don't clear.
      } catch {}
      inFlight = false;
      // Live session → refresh often; finished/idle → back off.
      if (on) timer = setTimeout(poll, complete ? 60_000 : 15_000);
    };
    poll();
    // Same fix as useF1Live's poll loop: a long-backgrounded tab gets its timers throttled
    // by the browser, so the scheduled re-poll can fire much later than intended — force an
    // immediate check on refocus instead of waiting for it.
    const onVisible = () => {
      if (document.visibilityState !== "hidden" && !inFlight) {
        clearTimeout(timer);
        poll();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      on = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Render nothing until there's a current, showable result — no reserved-height
  // placeholder, so the bar can't flash in and collapse out (that slid the page).
  if (!showable(r)) return null;
  const isRace = r.mode === "race";
  // Slower for longer grids; one full loop ≈ 2.4s per entry.
  const duration = Math.max(20, r.top.length * 2.4);

  return (
    <div className="reveal-in border-t border-white/10 py-3">
      {/* Line 1: session · RESULT */}
      <div className="mb-2 px-6 sm:px-8">
        <span
          className={`eyebrow inline-block rounded-sm px-2 py-1 text-[0.55rem] font-bold tracking-wide ${
            r.live ? "bg-red text-white" : "bg-white/15 text-white/75"
          }`}
        >
          {/* Driven by `live`, not `!complete`. A session that hasn't started yet is also
              "not complete", which had the ticker showing LIVE while the hero was still
              counting down to lights out. */}
          {r.session_name} · {r.live ? "LIVE" : "RESULT"}
        </span>
      </div>

      {/* Line 2: rolling results (edge-to-edge, fades both sides) */}
      <div className="relative overflow-hidden">
        <div className="ticker-track" style={{ animationDuration: `${duration}s` }}>
          {[0, 1].map((copy) => (
            <span key={copy} className="inline-flex shrink-0" aria-hidden={copy === 1}>
              {r.top.map((d) => (
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
