"use client";

import { useState } from "react";
import { useF1Live } from "./useF1Live";
import TrackMap from "./TrackMap";
import TimingBoard from "./TimingBoard";
import TyreTracker from "./TyreTracker";
import TelemetryCard from "./TelemetryCard";

function Header({
  badge,
  label,
  freeFeed,
}: {
  badge?: "live" | "replay";
  label: string;
  freeFeed?: boolean;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4 border-b-2 border-ink pb-2">
      <h3 className="font-display flex items-center gap-3 text-2xl sm:text-3xl">
        Live <span className="italic text-red">Tracking</span>
        {badge === "live" && (
          <span className="flex items-center gap-1.5 rounded-full bg-red px-2.5 py-1 text-[0.6rem] font-bold tracking-wider text-white">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-white" />
            LIVE
          </span>
        )}
        {badge === "replay" && (
          <span className="rounded-full bg-ink px-2.5 py-1 text-[0.6rem] font-bold tracking-wider text-white">
            LATEST
          </span>
        )}
        {freeFeed && (
          <span
            className="rounded-full border border-line px-2.5 py-1 text-[0.6rem] font-bold tracking-wider text-muted"
            title="Running on F1's free public feed — add an F1 TV token (F1_TV_TOKEN) for real-time, smoother tracking."
          >
            FREE FEED
          </span>
        )}
      </h3>
      <span className="eyebrow shrink-0 text-[0.6rem] text-muted">{label}</span>
    </div>
  );
}

export default function LiveSection() {
  const s = useF1Live();
  // Click-to-follow: selected driver is highlighted on the map + gets a telemetry card.
  const [selected, setSelected] = useState<number | null>(null);

  if (s.status === "error" || s.status === "idle" || s.status === "loading") {
    // Minimized: nothing is live, so collapse to a slim card explaining what's coming.
    return (
      <section className="rounded-lg border border-line bg-panel px-4 py-3">
        <div className="flex items-center gap-3">
          <span className={`h-2 w-2 shrink-0 rounded-full ${s.status === "loading" ? "live-dot bg-muted" : "bg-muted"}`} />
          <span className="font-display text-lg">
            Live <span className="italic text-red">Tracking</span>
          </span>
        </div>
        {s.status === "loading" ? (
          <span className="skeleton mt-2 block h-4 w-64" />
        ) : (
          <div className="mt-2 pl-5 text-sm text-muted">
            <p>No live Formula 1 session is currently running.</p>
            <p className="mt-1">
              Live driver tracking, telemetry, tyre strategy, and Race Control automatically
              become available when an official F1 session starts.
            </p>
          </div>
        )}
      </section>
    );
  }

  const leaderNum = s.order[0];
  const sessionLabel = `${s.session?.location} · ${s.session?.session_name}`;
  const label = s.replay ? `Latest session · ${sessionLabel}` : `${sessionLabel} · on track now`;

  const freeFeed = s.source === "free";

  return (
    <section>
      <Header badge={s.replay ? "replay" : "live"} label={label} freeFeed={freeFeed} />
      {freeFeed && (
        <p className="-mt-3 mb-4 text-xs text-muted">
          Running on F1&apos;s free public feed — for real-time, smoother tracking, add an F1 TV token.
        </p>
      )}

      {/* Track map + clean running order side by side */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="self-start">
          <TrackMap
            circuitKey={s.circuitKey}
            drivers={s.drivers}
            leaderNum={leaderNum}
            inPit={s.inPit}
            retired={s.retired}
            name={s.session?.location}
            trackStatus={s.trackStatus}
            selectedNum={selected}
            onSelect={setSelected}
          />
          {selected != null && (
            <TelemetryCard
              num={selected}
              driver={s.drivers.get(selected)}
              onClose={() => setSelected(null)}
            />
          )}
        </div>
        <TimingBoard
          mode={s.mode}
          order={s.order}
          drivers={s.drivers}
          positions={s.positions}
          intervals={s.intervals}
          laps={s.laps}
          retired={s.retired}
          selectedNum={selected}
          onSelect={setSelected}
        />
      </div>

      {/* Tyre Tracker — the rich board: gained/lost + gap/int + last + stint bars + fastest lap */}
      <div className="mt-4">
        <TyreTracker
          order={s.order}
          drivers={s.drivers}
          positions={s.positions}
          grids={s.grids}
          intervals={s.intervals}
          laps={s.laps}
          retired={s.retired}
          stints={s.tyreStints ?? new Map()}
          totalLaps={s.totalLaps}
          fastestLap={s.fastestLap}
        />
      </div>
    </section>
  );
}
