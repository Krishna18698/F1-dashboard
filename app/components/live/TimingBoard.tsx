"use client";

import { useEffect, useRef, useState } from "react";
import { Driver, IntervalRow, LapSummary } from "@/lib/openf1";
import { SessionMode } from "./useLiveSession";
import { formatDelta, formatGap, formatInterval, formatLap, hex } from "@/lib/format";

// FIA quali format: Q1 cuts the field to 15, Q2 cuts to 10 — fixed regardless of grid size.
const QUALI_CUTOFF: Record<number, number> = { 1: 15, 2: 10 };


/**
 * Mini-sector status codes from TimingData's Sectors[].Segments[].
 * Harvested live during Zandvoort qualifying rather than taken on faith — the codes actually
 * observed were 0, 2048, 2049, 2051 and 2064. 2064 showed up on drivers sitting in the pit
 * lane, and 0/2048 on sectors not yet run. 2052 (purple mini-sector) is the one value NOT
 * seen in the sample, so it's mapped from the obvious progression and should be treated as
 * unconfirmed until a purple mini-sector is observed.
 */
const MINI_SECTOR: Record<number, string> = {
  0: "bg-line", // not reached yet
  2048: "bg-line", // not set
  2049: "bg-amber-400", // completed, slower than personal best
  2051: "bg-emerald-500", // personal best
  2052: "bg-violet-500", // overall fastest (unconfirmed — see above)
  2064: "bg-sky-400", // in the pit lane
};

/** F1's own colour semantics: purple = fastest anyone, green = personal best. */
function sectorColour(s?: { overallFastest: boolean; personalFastest: boolean }): string {
  if (!s) return "text-muted";
  if (s.overallFastest) return "text-violet-500";
  if (s.personalFastest) return "text-emerald-600";
  return "text-ink-soft";
}

/** Bottom N of the still-active (not yet eliminated) field, in current ranked order. */
function dangerZone(order: number[], knockedOut: Set<number> | undefined, part: number | null | undefined): Set<number> {
  const cutoff = part ? QUALI_CUTOFF[part] : undefined;
  if (!cutoff) return new Set();
  const active = order.filter((n) => !knockedOut?.has(n));
  return active.length > cutoff ? new Set(active.slice(cutoff)) : new Set();
}

/** Ticks a "remaining ms as of the last poll" value down locally in real time, resyncing
 *  whenever a fresh value arrives — same pattern as the hero countdown. */
function useCountdown(remainingMs: number | null | undefined): string | null {
  const [display, setDisplay] = useState<number | null>(null);
  const base = useRef<{ ms: number; at: number } | null>(null);

  // Only touch the ref here (refs are exempt from the "no setState during render/effect
  // body" rule) — the interval below is the sole place that ever calls setDisplay, and it
  // does so from a timer callback, not synchronously during the effect's own execution.
  useEffect(() => {
    base.current = remainingMs != null ? { ms: remainingMs, at: Date.now() } : null;
  }, [remainingMs]);

  useEffect(() => {
    const id = setInterval(() => {
      setDisplay(base.current ? Math.max(0, base.current.ms - (Date.now() - base.current.at)) : null);
    }, 500);
    return () => clearInterval(id);
  }, []);

  if (display == null) return null;
  const totalSec = Math.floor(display / 1000);
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, "0")}`;
}

/**
 * Driver Live Tracker — a clean running order: position, driver, gap to leader + interval
 * (race) or best lap + gap (quali/practice). The richer strategy view lives in the Tyre Tracker.
 * In qualifying, shows which segment is live (Q1/Q2/Q3) and shades the elimination zone red.
 */
export default function TimingBoard({
  mode,
  order,
  drivers,
  positions,
  intervals,
  laps,
  retired,
  sectors,
  speeds,
  qualifyingPart,
  qualifyingRemainingMs,
  qualifyingSegmentEnded,
  nextQualifyingSegmentInMs,
  sprintQuali,
  knockedOut,
  selectedNum,
  onSelect,
}: {
  mode: SessionMode;
  order: number[];
  drivers: Map<number, Driver>;
  positions: Map<number, number>;
  intervals: Map<number, IntervalRow>;
  laps: Map<number, LapSummary>;
  retired?: Set<number>;
  sectors?: Map<number, { value: string; overallFastest: boolean; personalFastest: boolean; segments: number[] }[]>;
  speeds?: Map<number, Record<string, { value: string; overallFastest: boolean; personalFastest: boolean }>>;
  qualifyingPart?: number | null;
  qualifyingRemainingMs?: number | null;
  qualifyingSegmentEnded?: boolean;
  nextQualifyingSegmentInMs?: number | null;
  sprintQuali?: boolean;
  knockedOut?: Set<number>;
  selectedNum?: number | null;
  onSelect?: (num: number | null) => void;
}) {
  const isRace = mode === "race";
  const isQuali = mode === "quali";
  const countdown = useCountdown(qualifyingRemainingMs);
  const nextCountdown = useCountdown(nextQualifyingSegmentInMs);
  const segLabel = sprintQuali ? "SQ" : "Q";
  const fastest = [...laps.values()].reduce<number | null>((m, l) => {
    if (l.best == null) return m;
    return m == null || l.best < m ? l.best : m;
  }, null);

  const danger = isQuali ? dangerZone(order, knockedOut, qualifyingPart) : new Set<number>();

  // Sector columns only where sectors are the story (quali/practice) and only once there's
  // room — on a narrow screen they'd crush the driver name, so they collapse away and the
  // per-driver detail row below still carries them.
  const showSectors = !isRace && !!sectors?.size;
  const cols = isRace
    ? "grid-cols-[2rem_1fr_auto]"
    : showSectors
      ? "grid-cols-[2rem_1fr_auto_auto] sm:grid-cols-[2rem_1fr_repeat(3,auto)_auto_auto]"
      : "grid-cols-[2rem_1fr_auto_auto]";

  return (
    <div className="self-start">
      <div className="mb-2 flex items-center gap-2">
        <span className="eyebrow block text-[0.6rem] text-muted">
          Driver Live <span className="text-red">Tracker</span>
        </span>
        {isQuali && qualifyingPart && (
          /* A sprint weekend's segments are SQ1/SQ2/SQ3, not Q1/Q2/Q3 — same feed field,
             different session, and F1's own broadcast labels them separately.
             Once a segment's clock runs out it reads "SQ1 ENDED" (greyed) rather than
             sitting at 0:00 as though it were still running. */
          <span
            className={`rounded-sm px-1.5 py-0.5 text-[0.6rem] font-bold tracking-wider ${
              qualifyingSegmentEnded ? "bg-line text-ink-soft" : "bg-ink text-white"
            }`}
          >
            {segLabel}
            {qualifyingPart}
            {qualifyingSegmentEnded ? " ENDED" : ""}
          </span>
        )}
        {/* Running: time left in this segment. */}
        {isQuali && !qualifyingSegmentEnded && countdown && (
          <span className="tnum font-mono text-xs font-bold text-red" title="Time remaining in this segment">
            {countdown}
          </span>
        )}
        {/* Between segments: count down to the next one going green. The estimate is
            replaced by the real segment clock the moment F1 starts it. */}
        {isQuali && qualifyingSegmentEnded && qualifyingPart != null && qualifyingPart < 3 && (
          <span className="text-[0.6rem] font-bold tracking-wider text-muted">
            {segLabel}
            {qualifyingPart + 1} IN{" "}
            <span className="tnum font-mono text-xs text-red">{nextCountdown ?? "—"}</span>
          </span>
        )}
      </div>
      <div className="overflow-hidden rounded-lg border border-line">
        <div
          className={`grid ${cols} gap-2 border-b border-line bg-panel px-3 py-2 text-[0.6rem] font-bold tracking-wider text-muted`}
        >
          <span className="text-right">P</span>
          <span>Driver</span>
          {isRace ? (
            <span className="text-right">Gap / Int</span>
          ) : (
            <>
              {showSectors && (
                <>
                  <span className="hidden text-right sm:block">S1</span>
                  <span className="hidden text-right sm:block">S2</span>
                  <span className="hidden text-right sm:block">S3</span>
                </>
              )}
              <span className="text-right">Best</span>
              <span className="text-right">Gap</span>
            </>
          )}
        </div>

        <ol className="divide-y divide-line">
          {order.map((num, i) => {
            const d = drivers.get(num);
            const pos = isRace ? (positions.get(num) ?? i + 1) : i + 1;
            const isP1 = pos === 1;
            const isSel = num === selectedNum;
            const isOut = retired?.has(num);
            const isKnockedOut = knockedOut?.has(num);
            const inDanger = danger.has(num);
            const lap = laps.get(num);
            return (
              <li
                key={num}
                onClick={() => onSelect?.(isSel ? null : num)}
                className={`grid ${cols} cursor-pointer items-center gap-2 px-2 py-1.5 transition-colors sm:px-3 sm:py-2 ${
                  isSel
                    ? "bg-red/5 ring-1 ring-inset ring-red/30"
                    : inDanger
                      ? "bg-red/10 hover:bg-red/15"
                      : "hover:bg-panel"
                } ${isOut || isKnockedOut ? "opacity-50" : ""}`}
                title={
                  isKnockedOut
                    ? "Eliminated in an earlier segment"
                    : inDanger
                      ? "Provisionally eliminated if the session ended now"
                      : undefined
                }
              >
                <span className={`tnum text-right font-mono text-sm font-bold ${isP1 ? "text-red" : ""}`}>{pos}</span>

                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-4 w-1 shrink-0 rounded-full" style={{ backgroundColor: hex(d?.team_colour) }} />
                  <span className={`truncate text-sm font-semibold ${inDanger ? "text-red" : ""}`}>
                    {d?.name_acronym ?? num}
                  </span>
                  <span className="hidden truncate text-xs text-muted sm:inline">{d?.team_name}</span>
                </div>

                {isRace ? (
                  isOut ? (
                    <div className="text-right">
                      <span className="rounded-sm bg-ink px-1.5 py-0.5 text-[0.6rem] font-bold tracking-wider text-white">
                        DNF
                      </span>
                    </div>
                  ) : (
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
                  )
                ) : isKnockedOut ? (
                  <div className={`text-right ${showSectors ? "col-span-2 sm:col-span-5" : "col-span-2"}`}>
                    <span className="rounded-sm bg-ink px-1.5 py-0.5 text-[0.6rem] font-bold tracking-wider text-white">
                      OUT
                    </span>
                  </div>
                ) : (
                  <>
                    {showSectors &&
                      [0, 1, 2].map((si) => {
                        const sec = sectors?.get(num)?.[si];
                        return (
                          <span
                            key={si}
                            className={`tnum hidden text-right font-mono text-xs sm:block ${sectorColour(sec)}`}
                            title={sec?.overallFastest ? "Fastest of anyone" : sec?.personalFastest ? "Personal best" : undefined}
                          >
                            {sec?.value || "–"}
                          </span>
                        );
                      })}
                    <span className={`tnum text-right font-mono text-xs font-bold ${isP1 ? "text-red" : ""}`}>
                      {formatLap(lap?.best)}
                    </span>
                    <span className="tnum text-right font-mono text-[0.7rem] text-muted">
                      {isP1 ? "—" : formatDelta(lap?.best, fastest) || "—"}
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ol>
        {/* Selected driver: the fuller picture — each sector with F1's purple/green
            semantics, the mini-sector bars that make up it, and the speed traps. Driven by
            TimingData, which is ungated, so this works without a token as well. */}
        {selectedNum != null && !isRace && sectors?.get(selectedNum) && (
          <div className="border-t border-line bg-panel px-3 py-2.5">
            <div className="mb-2 flex items-center gap-2">
              <span className="eyebrow text-[0.55rem] text-muted">
                {drivers.get(selectedNum)?.name_acronym ?? selectedNum} · sectors
              </span>
              <button onClick={() => onSelect?.(null)} className="ml-auto text-[0.6rem] font-bold text-muted hover:text-ink">
                CLOSE
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {(sectors.get(selectedNum) ?? []).map((sec, i) => (
                <div key={i}>
                  <div className="flex items-baseline justify-between">
                    <span className="eyebrow text-[0.55rem] text-muted">S{i + 1}</span>
                    <span className={`tnum font-mono text-sm font-bold ${sectorColour(sec)}`}>{sec.value || "–"}</span>
                  </div>
                  {/* mini-sectors */}
                  <div className="mt-1 flex gap-0.5">
                    {(sec.segments ?? []).map((code, j) => (
                      <span
                        key={j}
                        className={`h-1.5 flex-1 rounded-sm ${MINI_SECTOR[code] ?? "bg-line"}`}
                        title={`mini-sector ${j + 1} (status ${code})`}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {speeds?.get(selectedNum) && (
              <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-2">
                {["I1", "I2", "FL", "ST"].map((k) => {
                  const sp = speeds.get(selectedNum!)?.[k];
                  if (!sp?.value) return null;
                  return (
                    <span key={k} className="text-[0.6rem] text-muted">
                      {k}{" "}
                      <span className={`tnum font-mono text-xs font-semibold ${sectorColour(sp)}`}>{sp.value}</span>
                      <span className="text-[0.55rem]"> km/h</span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
