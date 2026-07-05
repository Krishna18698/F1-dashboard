"use client";

import { useEffect, useState } from "react";

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

function trackStatusInfo(s?: string): { label: string; color: string } {
  switch (s) {
    case "1": return { label: "Track Clear", color: "#3fa34d" };
    case "2": return { label: "Yellow Flag", color: "#f5c518" };
    case "4": return { label: "Safety Car", color: "#ff8000" };
    case "5": return { label: "Red Flag", color: "#e10600" };
    case "6": return { label: "Virtual Safety Car", color: "#ff8000" };
    case "7": return { label: "VSC Ending", color: "#f5c518" };
    default: return { label: "Race Control", color: "#8a8a92" };
  }
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

export default function RaceControl() {
  const [data, setData] = useState<RaceControl | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let on = true;
    const poll = async () => {
      try {
        const d = (await (await fetch("/api/racecontrol", { cache: "no-store" })).json()) as RaceControl;
        if (on) setData(d);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, []);

  if (!data?.available) return null;
  const messages = data.messages ?? [];
  const ts = trackStatusInfo(data.trackStatus?.Status);

  return (
    <>
      {/* Always-visible latest-2 card (click for full history) */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="carbon-bg fixed bottom-3 right-3 z-40 w-72 max-w-[calc(100vw-1.5rem)] rounded-lg p-3 text-left shadow-xl ring-1 ring-white/15"
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: ts.color }} />
              <span className="eyebrow text-[0.55rem] text-red">Race Control</span>
            </span>
            <span className="text-[0.55rem] text-white/40">view all →</span>
          </div>
          {messages.slice(0, 2).map((m, i) => (
            <Msg key={`${m.Utc}-${i}`} m={m} />
          ))}
        </button>
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
