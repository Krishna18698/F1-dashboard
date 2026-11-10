"use client";

import { useState } from "react";
import type { LiveState } from "./liveTypes";
import { clock } from "./ReplayControls";
import { useRaceUpdates, type UpdateKind } from "./useRaceUpdates";

const FILTERS: { id: UpdateKind | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "incident", label: "Incidents" },
  { id: "battle", label: "Battles" },
];

const TAG: Record<UpdateKind, { label: string; className: string }> = {
  incident: { label: "Incident", className: "bg-red text-white" },
  battle: { label: "Battle", className: "bg-sky-400 text-ink" },
};

/** "All" is a ticker: the newest few, each new one pushing the oldest off, never a scroller. */
const LATEST = 5;

/** The session in words, under the running order: what happened, as it happens. */
export default function AnalysisPanel({ s }: { s: LiveState }) {
  const updates = useRaceUpdates(s);
  const [filter, setFilter] = useState<UpdateKind | "all">("all");
  const shown = filter === "all" ? updates.slice(0, LATEST) : updates.filter((u) => u.kind === filter);
  // Live: the time of day. A replay's clock is the session's own, so: time into the session.
  const when = (t: number) =>
    s.replayInfo ? clock(t - s.replayInfo.anchorMs) : new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return (
    <section aria-label="Session analysis" className="mt-6">
      <span className="eyebrow mb-2 block text-[0.6rem] text-muted">
        Session <span className="text-red">Analysis</span>
      </span>
      <div className="carbon-bg rounded-lg p-3 ring-1 ring-white/10 sm:p-4">
        <div className="mb-3 flex flex-wrap gap-1" role="group" aria-label="Filter updates">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${filter === f.id ? "bg-white text-ink" : "text-white/70 hover:text-white"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {shown.length ? (
          <ol className={`space-y-2 ${filter === "all" ? "" : "max-h-96 overflow-y-auto pr-1"}`} aria-live="polite">
            {shown.map((u) => (
              <li key={u.id} className="rounded-md bg-white/5 px-3 py-2 ring-1 ring-white/10">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 text-sm font-semibold text-white">{u.text}</p>
                  <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wider ${TAG[u.kind].className}`}>{TAG[u.kind].label}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3 text-xs text-white/60">
                  <span>{u.lap != null ? `Lap ${u.lap}` : ""}</span>
                  <span className="tnum font-mono">{when(u.t)}</span>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="py-6 text-center text-sm text-white/60">
            {updates.length
              ? "Nothing of this kind yet."
              : s.mode === "race"
                ? "Overtakes, cars closing in, flags, retirements and penalties appear here as they happen."
                : "Flags, retirements and penalties appear here as they happen."}
          </p>
        )}
      </div>
    </section>
  );
}
