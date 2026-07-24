"use client";

import { useEffect, useState } from "react";
import { usePolling } from "../usePolling";
import { trackStatusInfo } from "@/lib/trackStatus";
import { getPlaybackT } from "./framesStore";

const MIN_KEY = "pitwall:raceControlMinimized";

interface RcMessage {
  Utc?: string;
  Category?: string;
  Message?: string;
  Flag?: string;
}
interface RaceControl {
  available: boolean;
  trackStatus?: { Status?: string } | null;
  messages?: RcMessage[];
}

function msgColor(m: RcMessage): string {
  const cat = (m.Category ?? "").toLowerCase();
  const flag = (m.Flag ?? "").toLowerCase();
  const msg = (m.Message ?? "").toLowerCase();
  if (cat === "flag") {
    if (flag.includes("red")) return "#e10600";
    if (flag.includes("yellow")) return "#f5c518";
    if (flag.includes("green") || flag.includes("clear")) return "#3fa34d";
    if (flag.includes("blue")) return "#1e6bd6";
    if (flag.includes("chequered")) return "#e5e5e5";
    return "#8a8a92";
  }
  if (cat === "safetycar") return "#ff8000";
  if (cat === "drs") return "#1e6bd6";
  if (msg.includes("penalty") || msg.includes("investigation") || msg.includes("deleted")) return "#e10600";
  return "#8a8a92";
}

function fmtTime(utc?: string): string {
  if (!utc) return "";
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(utc) ? utc : utc + "Z";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function Msg({ m }: { m: RcMessage }) {
  return (
    <div className="flex items-start gap-2.5 py-2">
      <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: msgColor(m) }} />
      <div className="min-w-0">
        <p className="text-sm leading-snug text-white/90">{m.Message}</p>
        <span className="tnum font-mono text-[0.6rem] text-white/35">{fmtTime(m.Utc)}</span>
      </div>
    </div>
  );
}

export default function RaceControl({
  ready,
  view = "live",
  replayT0,
}: {
  ready: boolean;
  view?: "live" | "replay";
  replayT0?: number;
}) {
  const [data, setData] = useState<RaceControl | null>(null);
  const [open, setOpen] = useState(false);
  // Collapses the floating card down to a small dot — mostly for mobile, where the
  // latest-2 card can sit over other content and gets in the way. Remembered across
  // reloads so minimizing it once actually makes it stop being annoying.
  const [minimized, setMinimized] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        setMinimized(localStorage.getItem(MIN_KEY) === "1");
      } catch {}
    }, 0);
    return () => clearTimeout(id);
  }, []);
  const setMin = (v: boolean) => {
    setMinimized(v);
    try {
      localStorage.setItem(MIN_KEY, v ? "1" : "0");
    } catch {}
  };

  // Keeps polling regardless of `ready` (so data's already warm the moment it's shown) —
  // only relevant during a live session → 5s while active, 30s idle (pauses when hidden).
  // Once the map has real frames, ask for messages as of its OWN playback clock (the exact
  // instant the car dots are currently rendering, ~20s behind the freshest fetch for smooth
  // interpolation) rather than recomputing "now" independently — two clocks polling on
  // different cadences never quite agreed, which read as Race Control running ahead of the
  // drivers. `view`/`replayT0` remain the fallback before the map has any frames yet.
  usePolling(async () => {
    try {
      const t = getPlaybackT();
      const asOfParam = t > 0 ? `&asOf=${Math.floor(t)}` : "";
      const t0Param = view === "replay" && replayT0 ? `&t0=${replayT0}` : "";
      const d = (await (await fetch(`/api/racecontrol?view=${view}${t0Param}${asOfParam}`, { cache: "no-store" })).json()) as RaceControl;
      setData(d);
    } catch {}
  }, data?.available ? 5_000 : 30_000);

  // Don't appear before the Driver Live Tracker itself does — it was popping in well
  // before the map/board finished loading, which read as out of order.
  if (!ready || !data?.available) return null;
  const messages = data.messages ?? [];
  const ts = trackStatusInfo(data.trackStatus?.Status);

  if (minimized) {
    return (
      <button
        onClick={() => setMin(false)}
        aria-label="Show Race Control"
        className="carbon-bg fixed bottom-3 right-3 z-40 flex items-center gap-1.5 rounded-full px-3 py-2 shadow-xl ring-1 ring-white/15"
      >
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: ts.color }} />
        <span className="eyebrow text-[0.55rem] text-white/70">Race Control</span>
      </button>
    );
  }

  return (
    <>
      {/* Always-visible latest-2 card (click for full history) */}
      {!open && (
        <div className="carbon-bg fixed bottom-3 right-3 z-40 w-72 max-w-[calc(100vw-1.5rem)] rounded-lg p-3 shadow-xl ring-1 ring-white/15">
          <div className="mb-1 flex items-center justify-between gap-2">
            <button onClick={() => setOpen(true)} className="flex min-w-0 items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: ts.color }} />
              <span className="eyebrow text-[0.55rem] text-red">Race Control</span>
            </button>
            <div className="flex shrink-0 items-center gap-2.5">
              <button onClick={() => setOpen(true)} className="text-[0.55rem] text-white/40">
                view all →
              </button>
              <button onClick={() => setMin(true)} aria-label="Minimize Race Control" className="text-white/50 hover:text-white">
                −
              </button>
            </div>
          </div>
          <button onClick={() => setOpen(true)} className="block w-full text-left">
            {messages.slice(0, 2).map((m, i) => (
              <Msg key={`${m.Utc}-${i}`} m={m} />
            ))}
          </button>
        </div>
      )}

      {/* Backdrop */}
      {open && <div onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-black/50" />}

      {/* Drawer */}
      <div
        className={`carbon-bg fixed inset-y-0 right-0 z-50 flex w-80 max-w-[85vw] flex-col shadow-2xl ring-1 ring-white/10 transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h3 className="font-display text-lg text-white">
            Race <span className="italic text-red">Control</span>
          </h3>
          <button onClick={() => setOpen(false)} className="text-white/60 hover:text-white" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ts.color }} />
          <span className="text-sm font-semibold text-white">{ts.label}</span>
        </div>
        <div className="flex-1 divide-y divide-white/5 overflow-y-auto px-4">
          {messages.map((m, i) => (
            <Msg key={`${m.Utc}-${i}`} m={m} />
          ))}
        </div>
      </div>
    </>
  );
}
