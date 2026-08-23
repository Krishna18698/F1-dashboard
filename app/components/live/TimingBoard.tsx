"use client";

import { useEffect, useRef, useState } from "react";
import { Driver, IntervalRow, LapSummary } from "@/lib/openf1";
import { SessionMode } from "./useLiveSession";
import { formatDelta, formatGap, formatInterval, formatLap, hex } from "@/lib/format";

// Six drivers drop out of Q1 and six out of Q2, leaving ten for Q3 — the same in a sprint
// qualifying. Written as "how many are eliminated" rather than "how many advance": the old
// { 1: 15, 2: 10 } was the 20-car convention (20 -> 15 -> 10) and shaded SEVEN on the current
// 22-car grid, which goes 22 -> 16 -> 10. Counting from the back is also immune to a grid
// that changes size mid-season or a car sitting out.
const ELIMINATED_PER_SEGMENT = 6;


/** F1's own colour semantics: purple = fastest anyone, green = personal best. */
function sectorColour(s?: { overallFastest: boolean; personalFastest: boolean }): string {
  if (!s) return "text-muted";
  if (s.overallFastest) return "text-violet-500";
  if (s.personalFastest) return "text-emerald-600";
  return "text-ink-soft";
}

/** Bottom N of the still-active (not yet eliminated) field, in current ranked order. */
function dangerZone(order: number[], knockedOut: Set<number> | undefined, part: number | null | undefined): Set<number> {
  // Nothing to shade in the final segment — everyone left is racing for pole, not survival.
  if (!part || part >= 3) return new Set();
  const active = order.filter((n) => !knockedOut?.has(n));
  if (active.length <= ELIMINATED_PER_SEGMENT) return new Set();
  return new Set(active.slice(-ELIMINATED_PER_SEGMENT));
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

/** Same ticker as above, but counting down to an ABSOLUTE instant rather than a remaining
 *  duration. The clock is read inside the interval callback, never during render — reading it
 *  in the render body is impure and produces unstable output across incidental re-renders.
 *  Red-flag stoppages routinely run past an hour, so this grows an hours field rather than
 *  reporting "94:12". */
function useCountdownTo(atMs: number | null | undefined): string | null {
  const [display, setDisplay] = useState<number | null>(null);
  const target = useRef<number | null>(null);

  useEffect(() => {
    target.current = atMs ?? null;
  }, [atMs]);

  useEffect(() => {
    const id = setInterval(() => {
      setDisplay(target.current != null ? Math.max(0, target.current - Date.now()) : null);
    }, 500);
    return () => clearInterval(id);
  }, []);

  if (display == null) return null;
  const totalSec = Math.floor(display / 1000);
  const mm = Math.floor(totalSec / 60) % 60;
  const ss = String(totalSec % 60).padStart(2, "0");
  const hh = Math.floor(totalSec / 3600);
  return hh > 0 ? `${hh}:${String(mm).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
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
  qualifyingPart,
  qualifyingRemainingMs,
  qualifyingSegmentEnded,
  nextQualifyingSegmentInMs,
  sprintQuali,
  knockedOut,
  suspended,
  restartAtMs,
  formationLap,
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
  qualifyingPart?: number | null;
  qualifyingRemainingMs?: number | null;
  qualifyingSegmentEnded?: boolean;
  nextQualifyingSegmentInMs?: number | null;
  sprintQuali?: boolean;
  knockedOut?: Set<number>;
  /** Race is red-flagged and stopped (F1 SessionStatus "Aborted"). */
  suspended?: boolean;
  /** Announced restart instant, epoch ms — drives the countdown while suspended. */
  restartAtMs?: number | null;
  /** Field is circulating but not racing — the pre-race formation lap, or one of the extra
   *  formation laps that follow a red-flag restart. */
  formationLap?: boolean;
  selectedNum?: number | null;
  onSelect?: (num: number | null) => void;
}) {
  const isRace = mode === "race";
  // While the race is stopped, gap/interval are frozen at the instant of the flag and F1 sends
  // the leader a literal "LAP 3" in the gap field — so the timing column is worse than useless.
  // Blank it entirely and leave a plain running order until the race actually resumes.
  const redFlagged = isRace && suspended === true;
  // Not racing, but moving — so the lap counter climbs and gaps look like a race when they are
  // just queue spacing behind the safety car. Only shown when NOT suspended: a red flag is the
  // louder state and the two should never stack.
  const forming = isRace && !redFlagged && formationLap === true;
  const isQuali = mode === "quali";
  const countdown = useCountdown(qualifyingRemainingMs);
  const restartIn = useCountdownTo(restartAtMs);
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
  // The header row and each driver row are SEPARATE grids, so `auto` columns size themselves
  // independently — the narrow "S1" header ended up a different width from the "30.609"
  // beneath it and the columns visibly failed to line up. Fixed widths make both grids agree.
  const cols = isRace
    ? "grid-cols-[2rem_1fr_auto]"
    : showSectors
      ? "grid-cols-[2rem_1fr_4.5rem_3.5rem] sm:grid-cols-[2rem_1fr_repeat(3,4.25rem)_5rem_4rem]"
      : "grid-cols-[2rem_1fr_4.5rem_3.5rem]";

  // Stretch to the bento row rather than sizing to content (the old `self-start`). At wider
  // viewports the track map grows taller than the board's natural height, so a content-sized
  // board ended ~30px above the Tyre Allocation card beside it and the two columns visibly
  // failed to bottom out together. The rows below carry `grow`, so that slack is shared
  // evenly across all 20-odd of them instead of pooling as dead space under the last one.
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex items-center gap-2">
        <span className="eyebrow block text-[0.6rem] text-muted">
          Driver Live <span className="text-red">Tracker</span>
        </span>
        {redFlagged && (
          /* The authoritative signal is SessionStatus "Aborted", NOT TrackStatus — the latter
             goes back to "1" (green) as soon as marshals clear the wreck, while the race is
             still stopped and the field is queued in the pit lane. */
          <span className="flex items-center gap-1.5 rounded-sm bg-red px-1.5 py-0.5 text-[0.6rem] font-bold tracking-wider text-white">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-white" />
            RED FLAG · SUSPENDED
          </span>
        )}
        {redFlagged && restartIn && (
          <span className="text-[0.6rem] font-bold tracking-wider text-muted">
            RESUMES IN <span className="tnum font-timing text-xs text-red">{restartIn}</span>
          </span>
        )}
        {forming && (
          <span className="flex items-center gap-1.5 rounded-sm bg-amber-400 px-1.5 py-0.5 text-[0.6rem] font-bold tracking-wider text-ink">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-ink/70" />
            FORMATION LAP
          </span>
        )}
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
          <span className="tnum font-timing text-xs font-bold text-red" title="Time remaining in this segment">
            {countdown}
          </span>
        )}
        {/* Between segments: count down to the next one going green. The estimate is
            replaced by the real segment clock the moment F1 starts it. */}
        {isQuali && qualifyingSegmentEnded && qualifyingPart != null && qualifyingPart < 3 && (
          <span className="text-[0.6rem] font-bold tracking-wider text-muted">
            {segLabel}
            {qualifyingPart + 1} IN{" "}
            <span className="tnum font-timing text-xs text-red">{nextCountdown ?? "—"}</span>
          </span>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line">
        <div
          className={`grid ${cols} gap-2 border-b border-line bg-panel px-3 py-1.5 text-[0.6rem] font-bold tracking-wider text-muted`}
        >
          <span className="text-right">P</span>
          <span>Driver</span>
          {isRace ? (
            <span className="text-right">{redFlagged ? "" : "Gap / Int"}</span>
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

        <ol className="flex min-h-0 flex-1 flex-col divide-y divide-line">
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
                className={`grid ${cols} grow cursor-pointer items-center gap-2 px-2 py-1.5 transition-colors sm:px-3 sm:py-2 ${
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
                  ) : redFlagged ? (
                    /* Suspended: no timing at all. Everything F1 still sends in these fields is
                       stale — frozen at the instant of the flag — so the running order stands
                       on its own until the race resumes. */
                    <span />
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
      </div>
    </div>
  );
}
