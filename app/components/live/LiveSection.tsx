"use client";

import { useF1Live } from "./useF1Live";
import TrackMap from "./TrackMap";
import TimingBoard from "./TimingBoard";
import TyreTracker from "./TyreTracker";

function Header({
  badge,
  label,
}: {
  badge?: "live" | "replay";
  label: string;
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
      </h3>
      <span className="eyebrow shrink-0 text-[0.6rem] text-muted">{label}</span>
    </div>
  );
}

export default function LiveSection() {
  const s = useF1Live();

  if (s.status === "error" || s.status === "idle" || s.status === "loading") {
    // Minimized: nothing is live, so collapse to a single slim bar.
    return (
      <section className="flex items-center gap-3 rounded-lg border border-line bg-panel px-4 py-3">
        <span className="h-2 w-2 shrink-0 rounded-full bg-muted" />
        <span className="font-display text-lg">
          Live <span className="italic text-red">Tracking</span>
        </span>
        <span className="text-sm text-muted">
          {s.status === "loading" ? "checking for a live session…" : "no live session right now"}
        </span>
      </section>
    );
  }

  const leaderNum = s.order[0];
  const sessionLabel = `${s.session?.location} · ${s.session?.session_name}`;
  const label = s.replay ? `Latest session · ${sessionLabel}` : `${sessionLabel} · on track now`;

  return (
    <section>
      <Header badge={s.replay ? "replay" : "live"} label={label} />
      <div className="grid gap-4 lg:grid-cols-2">
        <TrackMap
          circuitKey={s.circuitKey}
          drivers={s.drivers}
          leaderNum={leaderNum}
          inPit={s.inPit}
          name={s.session?.location}
        />
        <TimingBoard
          mode={s.mode}
          order={s.order}
          drivers={s.drivers}
          positions={s.positions}
          intervals={s.intervals}
          stints={s.stints}
          laps={s.laps}
        />
      </div>

      {/* Tyre tracker below the driver tracker — current compound + laps, in order */}
      <div className="mt-4">
        <TyreTracker
          order={s.order}
          drivers={s.drivers}
          positions={s.positions}
          stints={s.stints}
          tyreLaps={s.tyreLaps}
        />
      </div>
    </section>
  );
}
