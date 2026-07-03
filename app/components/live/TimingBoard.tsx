"use client";

import { Driver, IntervalRow, LapSummary, StintRow } from "@/lib/openf1";
import { SessionMode } from "./useLiveSession";
import { formatDelta, formatGap, formatInterval, formatLap, hex, tyre } from "@/lib/format";

export default function TimingBoard({
  mode,
  order,
  drivers,
  positions,
  intervals,
  stints,
  laps,
}: {
  mode: SessionMode;
  order: number[];
  drivers: Map<number, Driver>;
  positions: Map<number, number>;
  intervals: Map<number, IntervalRow>;
  stints: Map<number, StintRow>;
  laps: Map<number, LapSummary>;
}) {
  const isRace = mode === "race";
  // Fastest lap in the session (for the quali/practice gap column).
  const fastest = [...laps.values()].reduce<number | null>((m, l) => {
    if (l.best == null) return m;
    return m == null || l.best < m ? l.best : m;
  }, null);

  const cols = isRace
    ? "grid-cols-[2rem_1fr_auto_auto]"
    : "grid-cols-[2rem_1fr_auto_auto_auto]";

  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <div
        className={`grid ${cols} gap-2 border-b border-line bg-panel px-3 py-2 text-[0.6rem] font-bold tracking-wider text-muted`}
      >
        <span className="text-right">P</span>
        <span>Driver</span>
        {isRace ? (
          <>
            <span className="text-right">Gap</span>
            <span className="pl-2 text-center">Tyre</span>
          </>
        ) : (
          <>
            <span className="text-right">Best</span>
            <span className="text-right">Gap</span>
            <span className="pl-2 text-center">Lap</span>
          </>
        )}
      </div>

      <ol className="divide-y divide-line">
        {order.map((num, i) => {
          const d = drivers.get(num);
          const pos = isRace ? (positions.get(num) ?? i + 1) : i + 1;
          const isP1 = pos === 1;
          const t = tyre(stints.get(num)?.compound);
          const lap = laps.get(num);
          return (
            <li key={num} className={`grid ${cols} items-center gap-2 px-3 py-2`}>
              <span
                className={`tnum text-right font-mono text-sm font-bold ${isP1 ? "text-red" : ""}`}
              >
                {pos}
              </span>

              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="h-4 w-1 shrink-0 rounded-full"
                  style={{ backgroundColor: hex(d?.team_colour) }}
                />
                <span className="truncate text-sm font-semibold">
                  {d?.name_acronym ?? num}
                </span>
                <span className="hidden truncate text-xs text-muted sm:inline">
                  {d?.team_name}
                </span>
              </div>

              {isRace ? (
                <>
                  <div className="text-right">
                    <span className="tnum block font-mono text-xs font-semibold">
                      {formatGap(intervals.get(num), isP1)}
                    </span>
                    {!isP1 && (
                      <span className="tnum block font-mono text-[0.6rem] text-muted">
                        {formatInterval(intervals.get(num))}
                      </span>
                    )}
                  </div>
                  <TyrePill t={t} title={stints.get(num)?.compound} />
                </>
              ) : (
                <>
                  <span
                    className={`tnum text-right font-mono text-xs font-bold ${isP1 ? "text-red" : ""}`}
                  >
                    {formatLap(lap?.best)}
                  </span>
                  <span className="tnum text-right font-mono text-[0.7rem] text-muted">
                    {isP1 ? "—" : formatDelta(lap?.best, fastest) || "—"}
                  </span>
                  <span className="tnum text-center font-mono text-[0.7rem] text-muted">
                    {lap?.count ?? 0}
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function TyrePill({ t, title }: { t: { color: string; short: string }; title?: string }) {
  return (
    <div className="flex items-center justify-center pl-2">
      <span
        className="flex h-6 w-6 items-center justify-center rounded-full text-[0.6rem] font-bold ring-2"
        style={{
          backgroundColor: t.color,
          borderColor: t.color,
          color: t.short === "M" ? "#111" : "#fff",
        }}
        title={title ?? "Unknown"}
      >
        {t.short}
      </span>
    </div>
  );
}
