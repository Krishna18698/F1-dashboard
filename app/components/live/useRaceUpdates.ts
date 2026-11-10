"use client";

import { useEffect, useRef, useState } from "react";
import { trackStatusInfo } from "@/lib/trackStatus";
import { getPlaybackT, replayActive } from "./framesStore";
import type { LiveState } from "./liveTypes";

export type UpdateKind = "incident" | "battle";

export interface RaceUpdate {
  id: number;
  kind: UpdateKind;
  lap: number | null;
  /** The map's instant when it happened: clock time live, the session's own clock in a replay. */
  t: number;
  text: string;
}

/* Race Control's card shares the messages it is showing here, so the feed can pick out the
   penalties and investigations without fetching them a second time. */
type RcLine = { Utc?: string; t?: number; Message?: string };
let rcLines: RcLine[] = [];
const rcSubs = new Set<() => void>();
export function publishRaceControl(lines: RcLine[]): void {
  rcLines = lines;
  rcSubs.forEach((fn) => fn());
}

const MAX_UPDATES = 200;
// Worth a line: time penalties, investigations and the like, not every track-limits note.
const RC_WORTH_SHOWING = /PENALTY|INVESTIGAT|DISQUALIF|STOP\/GO|BLACK FLAG\b/i;
// Closing fast enough, near enough and not yet there: a battle about to happen.
const CLOSING_RATE = 0.25; // s per lap, averaged over the last few laps
const CLOSING_WITHIN = 5; // s
const BATTLE_GAP = 1; // s: inside this it's a battle already
const CLOSING_LAPS = 3; // laps the rate is measured over

function seconds(v: string | number | null | undefined): number | null {
  if (typeof v === "number") return v;
  const raw = String(v ?? "");
  if (/l/i.test(raw)) return null; // "1 L", "+1 LAP"
  const n = parseFloat(raw.replace("+", ""));
  return Number.isFinite(n) ? n : null;
}

interface Seen {
  positions: Map<number, number>;
  retired: Set<number>;
  inPit: Set<number>;
  track: string | null;
  // Each car's interval to the car ahead at the end of each lap, and who that was, for the closing rate.
  gaps: Map<number, { lap: number; gap: number; ahead: number }[]>;
  closing: Map<string, number>; // "chaser>target" → the lap last reported
  rc: Set<string>;
  /** The map's instant when the feed started. Race Control's history can arrive after that (its
   *  card fetches on its own), and none of it is news: a penalty from lap 3 isn't "now" on lap 25. */
  since: number;
}

/** The map's instant: the session's own clock in a replay; live with no map drawing (no token,
 *  so no car positions), the clock is the next best thing. */
function mapInstant(): number {
  return replayActive() ? getPlaybackT() : getPlaybackT() || Date.now();
}

function baseline(s: LiveState): Seen {
  return {
    positions: new Map(s.positions),
    retired: new Set(s.retired),
    inPit: new Set(s.inPit),
    track: s.trackStatus ?? null,
    gaps: new Map(),
    closing: new Map(),
    rc: new Set(rcLines.map((m) => `${m.Utc}|${m.Message}`)),
    since: mapInstant(),
  };
}

/** What has changed since the last state, as lines for the feed. */
function changes(s: LiveState, seen: Seen): Omit<RaceUpdate, "id" | "t">[] {
  const out: Omit<RaceUpdate, "id" | "t">[] = [];
  const lap = s.mode === "race" ? (s.currentLap ?? null) : null;
  const add = (kind: UpdateKind, text: string) => out.push({ kind, lap, text });
  const tla = (n: number) => s.drivers.get(n)?.name_acronym ?? String(n);
  const racing = s.mode === "race" && (s.currentLap ?? 0) >= 2 && !["4", "5", "6", "7"].includes(s.trackStatus ?? "");

  // Flags that change the session: the safety cars, a red flag, and their end.
  const track = s.trackStatus ?? null;
  if (track !== seen.track) {
    const big = (c: string | null) => ["4", "5", "6"].includes(c ?? "");
    if (big(track)) add("incident", trackStatusInfo(track ?? undefined).label);
    else if (big(seen.track) && track === "1") add("incident", "Track clear");
    seen.track = track;
  }

  for (const n of s.retired ?? []) {
    if (!seen.retired.has(n)) add("incident", `${tla(n)} is out of the ${s.mode === "race" ? "race" : "session"}`);
  }
  seen.retired = new Set(s.retired);

  for (const m of rcLines) {
    const key = `${m.Utc}|${m.Message}`;
    if (seen.rc.has(key)) continue;
    seen.rc.add(key);
    if (m.t != null && m.t < seen.since) continue;
    if (m.Message && RC_WORTH_SHOWING.test(m.Message)) add("incident", m.Message);
  }

  if (s.mode === "race") {
    // Overtakes: two cars swapping places on track, not one of them stopping.
    if (racing) {
      for (let i = 0; i + 1 < s.order.length; i++) {
        const a = s.order[i];
        const b = s.order[i + 1];
        const passed = seen.positions.get(a) === s.positions.get(b) && seen.positions.get(b) === s.positions.get(a);
        const onTrack = ![a, b].some((n) => s.inPit?.has(n) || seen.inPit.has(n) || s.retired?.has(n));
        if (passed && onTrack) add("battle", `${tla(a)} passes ${tla(b)} for P${s.positions.get(a)}`);
      }
    }

    // Closing: each car's interval at the end of each of its laps.
    for (let i = 1; i < s.order.length; i++) {
      const n = s.order[i];
      const done = s.laps.get(n)?.count ?? 0;
      const gap = seconds(s.intervals.get(n)?.interval);
      const target = s.order[i - 1];
      // Only green-flag laps count: gaps close up behind a safety car whatever anyone's pace.
      // Nor a lap where either car is in the pit lane: the one stopping loses time on purpose.
      if (s.inPit?.has(n) || s.inPit?.has(target) || gap == null || !racing) {
        seen.gaps.set(n, []);
        continue;
      }
      // A different car ahead starts the count again: the earlier gaps were to someone else.
      // Without this, a car just passed "closed" by its old gap minus its new one (São Paulo
      // 2026: SAI "closing on BEA by 4.73s/lap" the lap after BEA went by).
      const prev = seen.gaps.get(n) ?? [];
      const log = prev.at(-1)?.ahead === target ? prev : [];
      if (log.at(-1)?.lap === done) continue;
      log.push({ lap: done, gap, ahead: target });
      seen.gaps.set(n, log.slice(-(CLOSING_LAPS + 1)));
      if (log.length <= CLOSING_LAPS) continue;
      const first = log[log.length - 1 - CLOSING_LAPS];
      const rate = (first.gap - gap) / CLOSING_LAPS;
      if (rate < CLOSING_RATE || gap > CLOSING_WITHIN || gap <= BATTLE_GAP) continue;
      const key = `${n}>${target}`;
      if (done - (seen.closing.get(key) ?? -99) < 5) continue;
      seen.closing.set(key, done);
      const inLaps = Math.max(1, Math.ceil((gap - BATTLE_GAP) / rate));
      add("battle", `${tla(n)} is closing on ${tla(target)} by ${rate.toFixed(2)}s/lap: gap ${gap.toFixed(1)}s, within a second in ~${inLaps} lap${inLaps === 1 ? "" : "s"}`);
    }
  }

  seen.positions = new Map(s.positions);
  seen.inPit = new Set(s.inPit);
  return out;
}

/**
 * What's happening, in words: overtakes and cars closing in, flags, retirements and penalties.
 * Worked out in the browser by comparing each state with the last, and that state is already on
 * the map's clock, so a line lands as the cars do it. It covers what happened while the page was
 * open. A jump in a replay starts it over, since what came before it no longer leads up to
 * what's on screen.
 */
export function useRaceUpdates(s: LiveState): RaceUpdate[] {
  const [updates, setUpdates] = useState<RaceUpdate[]>([]);
  const seen = useRef<Seen | null>(null);
  const scope = useRef<string | null>(null);
  const nextId = useRef(1);
  // Bumped when Race Control's lines change, so they're read even if nothing else moved.
  const [rcTick, setRcTick] = useState(0);

  useEffect(() => {
    const fn = () => setRcTick((v) => v + 1);
    rcSubs.add(fn);
    return () => {
      rcSubs.delete(fn);
    };
  }, []);

  useEffect(() => {
    if (s.status !== "live" || !s.order.length) return;
    const here = `${s.session?.session_name}|${s.epoch}`;
    if (scope.current !== here || !seen.current) {
      const fresh = scope.current !== null && scope.current !== here;
      scope.current = here;
      seen.current = baseline(s);
      if (fresh) {
        const id = setTimeout(() => setUpdates([]), 0);
        return () => clearTimeout(id);
      }
      return;
    }
    const lines = changes(s, seen.current);
    if (!lines.length) return;
    const t = mapInstant();
    const stamped = lines.map((l) => ({ ...l, id: nextId.current++, t })).reverse();
    // Not cancelled by the next run: these lines have already been counted as seen.
    setTimeout(() => setUpdates((prev) => [...stamped, ...prev].slice(0, MAX_UPDATES)), 0);
  }, [s, rcTick]);

  return updates;
}
