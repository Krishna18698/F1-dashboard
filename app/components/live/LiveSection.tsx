"use client";

import { useEffect, useState } from "react";
import { useF1Live } from "./useF1Live";
import TrackMap from "./TrackMap";
import TimingBoard from "./TimingBoard";
import TyreTracker from "./TyreTracker";
import TyreAllocation from "./TyreAllocation";
import SectorDeltas from "./SectorDeltas";
import TelemetryCard from "./TelemetryCard";
import MyTokenCard from "./MyTokenCard";
import RaceControl from "./RaceControl";
import { useHasFrames } from "./framesStore";
import { getStoredVisitorToken } from "@/lib/visitorToken";
import { F1_LIVE } from "@/lib/live/liveConfig";

type View = "live" | "replay";

/** Live/Replay switch — sits above the whole section so it's reachable regardless of
 *  whether anything's currently live. Defaults to "live"; switching is the user's own
 *  explicit choice, never automatic. */
function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div className="mb-3 inline-flex rounded-full border border-line p-0.5">
      {(["live", "replay"] as const).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`rounded-full px-3 py-1 text-[0.65rem] font-bold tracking-wider transition-colors ${
            view === v ? (v === "live" ? "bg-red text-white" : "bg-ink text-white") : "text-muted hover:text-ink"
          }`}
        >
          {v.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function Header({
  live,
  label,
  freeFeed,
  ended,
}: {
  live?: boolean;
  label: string;
  freeFeed?: boolean;
  ended?: boolean;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-1 border-b-2 border-ink pb-2">
      <h3 className="font-display flex flex-wrap items-center gap-2 text-xl sm:gap-3 sm:text-3xl">
        <span className="whitespace-nowrap">
          Live <span className="italic text-red">Tracking</span>
        </span>
        {live && !ended && (
          <span className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-red px-2.5 py-1 text-[0.6rem] font-bold tracking-wider text-white">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-white" />
            LIVE
          </span>
        )}
        {/* Session is over but still F1's current one — the board below is a FINAL
            classification, so say so rather than leaving a red LIVE dot on a finished race. */}
        {ended && (
          <span className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-ink px-2.5 py-1 text-[0.6rem] font-bold tracking-wider text-white">
            <span aria-hidden>&#127937;</span>
            FINAL
          </span>
        )}
        {freeFeed && (
          <span
            className="whitespace-nowrap rounded-full border border-line px-2.5 py-1 text-[0.6rem] font-bold tracking-wider text-muted"
            title="Running on F1's free public feed — add an F1 TV token (F1_TV_TOKEN) for real-time, smoother tracking."
          >
            FREE FEED
          </span>
        )}
      </h3>
      <span className="eyebrow ml-auto text-right text-[0.6rem] text-muted">{label}</span>
    </div>
  );
}

export default function LiveSection({ serverKnowsNothingLive = false }: { serverKnowsNothingLive?: boolean }) {
  const [view, setView] = useState<View>("live");
  // When switching INTO replay, stamp "now" as the anchor every consumer of replay data
  // (useF1Live for the map/board, RaceControl for messages) uses to compute the virtual
  // clock — so both agree on the same instant instead of each picking their own "now" a
  // few ms apart, and so every switch into replay starts fresh from lights out. Set in the
  // click handler (not an effect) so it lands in the same render/tick as the view change.
  const [replayT0, setReplayT0] = useState(() => Date.now());
  const changeView = (v: View) => {
    if (v === "replay") setReplayT0(Date.now());
    setView(v);
  };
  const s = useF1Live(view, replayT0, serverKnowsNothingLive);
  // Click-to-follow: selected driver is highlighted on the map + gets a telemetry card.
  const [selected, setSelected] = useState<number | null>(null);
  // Same signal TrackMap gates its own reveal on — Race Control was popping in well before
  // the map/board actually had anything to show, which read as out of order. Called
  // unconditionally (rules of hooks) even though it only matters in the branch below.
  const trackingReady = useHasFrames();

  // Whether EITHER a token is available — the owner's (server-known) or a visitor's own
  // (their browser's localStorage) — so the idle state can say "live feed is ready" instead
  // of implying tracking is unavailable when it's really just that nothing's on track yet.
  const [hasVisitorToken, setHasVisitorToken] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setHasVisitorToken(!!getStoredVisitorToken()), 0);
    return () => clearTimeout(id);
  }, []);
  // Only when the OWNER's token covers it and the visitor hasn't added their own — if they
  // have, MyTokenCard below already tells them its status ("active"/expired/issue), and
  // showing this banner too would just repeat the same reassurance twice.
  const showLiveFeedBanner = s.ownerTokenConfigured && !hasVisitorToken;

  if (s.status === "error" || s.status === "idle" || s.status === "loading") {
    // Minimized: nothing is live, so collapse to a slim card explaining what's coming.
    return (
      <div>
        <h3 className="font-display mb-3 text-2xl sm:text-3xl">
          Live <span className="italic text-red">Tracking</span>
        </h3>
        <section className="rounded-lg border border-line bg-panel px-4 py-3">
          <ViewToggle view={view} onChange={changeView} />
          {s.status === "loading" ? (
            <span className="skeleton mt-2 block h-4 w-64" />
          ) : view === "replay" ? (
            <div className="mt-2 pl-5 text-sm">
              <p className="font-medium text-ink-soft">No past session is available to replay yet.</p>
            </div>
          ) : (
            <div className="mt-2 pl-5 text-sm">
              {s.scheduledLive ? (
                <>
                  <p className="font-medium text-ink-soft">
                    {s.scheduledLive.location} · {s.scheduledLive.session_name} is happening right now.
                  </p>
                  <p className="mt-1 text-ink-soft/80">
                    Add your F1 TV token below to watch live, or{" "}
                    <button onClick={() => changeView("replay")} className="font-semibold text-red underline underline-offset-2">
                      click here
                    </button>{" "}
                    to watch a replay of the most recent session instead.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium text-ink-soft">No live Formula 1 session is currently running.</p>
                  <p className="mt-1 text-ink-soft/80">
                    {/* Say what actually arrives without a token. The old copy listed driver
                        tracking and telemetry alongside everything else, which reads as a promise
                        that all of it appears when a session starts — but those two are the only
                        parts F1 gates. Everything named here works on an anonymous connection. */}
                    When a session starts you&apos;ll get the{" "}
                    <span className="font-medium text-ink-soft">timing board, tyre strategy, sector
                    times and Race Control</span>{" "}
                    live — no token needed. A token adds the driver tracker map and per-car
                    telemetry.{" "}
                    <button onClick={() => changeView("replay")} className="font-semibold text-red underline underline-offset-2">
                      Click here
                    </button>{" "}
                    to watch a replay of the most recent session instead.
                  </p>
                </>
              )}
              {showLiveFeedBanner && !s.scheduledLive && (
                <p className="mt-3 rounded-md border border-line bg-white/50 px-3 py-2 text-ink-soft/90">
                  <span className="font-semibold text-ink">Live feed is available</span> — tracking will start
                  automatically the moment an official session goes live, no action needed.
                </p>
              )}
              {/* Wider than the old max-w-md: at 28rem the card's copy wrapped to four cramped
                  lines once it started naming what a token actually unlocks. */}
              <div className="mt-3 max-w-2xl">
                <MyTokenCard tokenIssue={s.tokenIssue} ownerHasToken={s.ownerTokenConfigured} />
              </div>
            </div>
          )}
          <RaceControl ready={false} view={view} replayT0={replayT0} />
        </section>
      </div>
    );
  }

  const leaderNum = s.order[0];
  // Once eliminated in a prior quali segment (feed's KnockedOut flips true right as the
  // NEXT segment starts), the driver stays on the board — TimingBoard greys the row out and
  // shows an "OUT" chip instead of dropping them entirely. But `s.order` is sorted purely by
  // best lap time, and an eliminated driver's time is frozen from an EARLIER segment — so
  // sorted by raw time alone, "OUT" rows land interleaved among the current segment's danger
  // zone instead of grouped together. Partition instead: still-active drivers first (in their
  // existing order), eliminated drivers pushed to the end (also in their existing order).
  const boardOrder =
    s.mode === "quali" && s.knockedOut
      ? [...s.order.filter((n) => !s.knockedOut!.has(n)), ...s.order.filter((n) => s.knockedOut!.has(n))]
      : s.order;
  const sessionLabel = `${s.session?.location} · ${s.session?.session_name}`;
  const label = s.replay
    ? `Replay · ${sessionLabel}`
    : s.sessionEnded
      ? `${sessionLabel} · final classification`
      : `${sessionLabel} · on track now`;

  const freeFeed = s.source === "free";
  // The feed can't carry car positions at all (anonymous hub connection), as opposed to
  // simply not having received any yet — the map would never draw, so don't render one.
  const mapUnavailable = s.mapAvailable === false;
  // Session finished, but still F1's current one — the board is a FINAL classification.
  // Never in replay (that's a past session by definition and already labelled as such).
  const ended = !s.replay && s.sessionEnded === true;

  return (
    <section>
      <Header live={!s.replay} label={label} freeFeed={freeFeed} ended={ended} />
      <ViewToggle view={view} onChange={changeView} />
      {s.replay && (
        <p className="-mt-3 mb-4 text-xs text-muted">
          Showing a replay of the most recent session, from lights out — not real-time.
        </p>
      )}
      {!s.replay && <MyTokenCard tokenIssue={s.tokenIssue} ownerHasToken={s.ownerTokenConfigured} />}

      {/* Track map + clean running order side by side */}
      {/* items-stretch (the grid default) lets the shorter column fill the taller one's
          height; the left column then distributes that height between the tracker and the
          tyre card so there's no gap under them — with or without a driver selected. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          {F1_LIVE.driverTrackerDisabled && !s.replay ? (
            <div className="flex shrink-0 flex-col">
              <span className="eyebrow mb-2 block text-[0.6rem] text-muted">
                Driver <span className="text-red">Tracker</span>
              </span>
              <div className="flex aspect-square w-full items-center justify-center rounded-lg carbon-bg px-6 text-center text-sm text-white/50 ring-1 ring-white/10">
                Temporarily unavailable — F1&apos;s own live position data is having issues
                right now. Timing, tyres, and Race Control are unaffected.
              </div>
            </div>
          ) : mapUnavailable ? (
            /* Everything on this page except the car positions is coming through live — F1
               serves timing/tyres/race control to anyone, but gates Position.z behind a
               token. Say that plainly instead of rendering a map that can never draw. */
            <div className="flex shrink-0 flex-col">
              <span className="eyebrow mb-2 block text-[0.6rem] text-muted">
                Driver <span className="text-red">Tracker</span>
              </span>
              <div className="relative flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-lg carbon-bg px-6 text-center ring-1 ring-white/10">
                {/* LapCount is NOT one of the token-gated topics (only Position.z and
                    CarData.z are), so the race lap counter is available here too — it just
                    used to be rendered exclusively inside TrackMap, which this placeholder
                    replaces. Same placement/styling as the map's own badge. */}
                {s.mode === "race" && (s.totalLaps ?? 0) > 0 && !s.formationLap && (
                  <span
                    className="tnum absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 font-mono text-[0.65rem] font-bold tracking-wider text-white/85"
                    title="Progress through the race — lap X of Y"
                  >
                    LAP {s.currentLap ?? 0}/{s.totalLaps}
                  </span>
                )}
                {s.mode === "race" && s.formationLap && (
                  <span className="absolute right-3 top-3 rounded-full bg-yellow-400/85 px-2.5 py-1 text-[0.65rem] font-bold tracking-wider text-black">
                    FORMATION LAP
                  </span>
                )}
                <p className="text-sm text-white/70">Live driver tracking needs an F1 TV token.</p>
                <p className="text-xs text-white/45">
                  Timing, tyres, and Race Control below are live right now — only the car
                  positions on track are restricted by F1. Add your token below to see them.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex shrink-0 flex-col">
            <TrackMap
              circuitKey={s.circuitKey}
              drivers={s.drivers}
              leaderNum={leaderNum}
              inPit={s.inPit}
              retired={s.retired}
              name={s.session?.location}
              trackStatus={s.trackStatus}
              formationLap={s.formationLap}
              laps={s.mode === "race" ? { current: s.currentLap ?? 0, total: s.totalLaps ?? 0 } : undefined}
              selectedNum={selected}
              onSelect={setSelected}
            />
            </div>
          )}
          {/* Only where there's live telemetry to show. Without a token CarData is gated, and
              the card collapsed to sector times the timing board already carries in its own
              S1/S2/S3 columns — an near-empty panel restating what's beside it. Selecting a
              driver still highlights their row; there's just no card. */}
          {/* Sectors on this card are quali-only: they're how a qualifying lap is read,
              whereas a race is about gaps and strategy — there the card is telemetry alone. */}
          {selected != null && !mapUnavailable && (
            <TelemetryCard
              num={selected}
              driver={s.drivers.get(selected)}
              onClose={() => setSelected(null)}
              sectors={s.mode === "quali" ? s.sectors?.get(selected) : undefined}
              lapResets={s.lapResets}
            />
          )}
          {/* Absorbs the column's spare height, and gives it back when the telemetry card
              appears — so the tracker above keeps a constant size either way. */}
          {(s.mode === "race" || s.mode === "quali") && (
            <div className="flex min-h-0 flex-1 flex-col">
              <TyreAllocation
                order={s.order}
                drivers={s.drivers}
                positions={s.positions}
                weekendTyresLeft={s.weekendTyresLeft ?? new Map()}
                columns={2}
              />
            </div>
          )}
        </div>
        {/* Right column: the board and the sector analysis that reads off it, stacked. Keeping
            them together means "who is where" and "where each of them is losing it" sit in
            the same column rather than across the page from one another. */}
        <div className="flex flex-col gap-4">
        <TimingBoard
          mode={s.mode}
          order={boardOrder}
          drivers={s.drivers}
          positions={s.positions}
          intervals={s.intervals}
          laps={s.laps}
          retired={s.retired}
          sectors={s.sectors}
          qualifyingPart={s.qualifyingPart}
          sprintQuali={/sprint/i.test(s.session?.session_name ?? "")}
          qualifyingRemainingMs={s.qualifyingRemainingMs}
          qualifyingSegmentEnded={s.qualifyingSegmentEnded}
          nextQualifyingSegmentInMs={s.nextQualifyingSegmentInMs}
          knockedOut={s.knockedOut}
          suspended={s.sessionStatus === "Aborted"}
          restartAtMs={s.suspendedRestartMs}
          formationLap={s.formationLap}
          selectedNum={selected}
          onSelect={setSelected}
        />
          {/* Quali only for now: sector-by-sector deficits are the story of a qualifying lap.
              Race gets the full-width Tyre Tracker below instead. Driven purely by sector
              times, so it behaves the same with or without a token. */}
          {s.mode === "quali" && (
            <div>
              <SectorDeltas
                order={s.order}
                drivers={s.drivers}
                positions={s.positions}
                bestSectors={s.bestSectors ?? new Map()}
              />
            </div>
          )}
        </div>
      </div>

      {/* Tyre Tracker — the rich board: gained/lost + gap/int + last + stint bars + fastest lap.
          Race only — practice has no strategy/lap axis, and qualifying gets its own
          Tyre Allocation card instead (segment-scoped, not the race-style stint bar). */}
      {s.mode === "race" && (
        <div className="mt-4">
          <TyreTracker
            order={boardOrder}
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
      )}

      {/* `trackingReady` normally holds Race Control back until the map has frames, so the
          two don't appear out of order. With no map at all there are no frames to wait for —
          gating on them would hide Race Control permanently. */}
      <RaceControl ready={trackingReady || mapUnavailable || ended} view={view} replayT0={replayT0} />
    </section>
  );
}
