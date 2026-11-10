"use client";

import { useEffect, useState } from "react";
import { getFrames, replayNow, replayRate, resetFrames, setReplayClock } from "./framesStore";
import type { ReplayInfo } from "./liveTypes";

const SPEEDS = [1, 2, 4];

export interface ReplayPick {
  path: string;
  year: number;
}

interface SessionOption {
  path: string;
  name: string;
  startMs: number;
}

/** "1:21:04" from the start of the replay (or "21:04" under an hour). */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/**
 * Season and session pickers. Shown with the controls, and on its own when a picked session
 * turns out to have nothing to play, so there is always a way back to another one.
 */
export function ReplaySessionPicker({
  current,
  onPick,
  dark = true,
}: {
  current: string | null;
  onPick: (pick: ReplayPick) => void;
  dark?: boolean;
}) {
  const [year, setYear] = useState<number | null>(null);
  const [years, setYears] = useState<number[]>([]);
  const [sessions, setSessions] = useState<SessionOption[]>([]);

  useEffect(() => {
    let gone = false;
    const load = async () => {
      try {
        const q = year ? `?year=${year}` : "";
        const r = await fetch(`/api/replay/sessions${q}`, { signal: AbortSignal.timeout(20_000) });
        const d = (await r.json()) as { year: number; years: number[]; sessions: SessionOption[] };
        if (gone) return;
        setYears(d.years);
        setSessions(d.sessions);
        if (year == null) setYear(d.year);
      } catch {}
    };
    void load();
    return () => {
      gone = true;
    };
  }, [year]);

  const field = dark
    ? "rounded-md border border-white/15! bg-white/5 px-2 py-1.5 text-xs text-white"
    : "rounded-md border border-line bg-paper px-2 py-1.5 text-xs text-ink";
  const known = sessions.some((s) => s.path === current);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <select aria-label="Season" value={year ?? ""} onChange={(e) => setYear(Number(e.target.value))} className={field}>
        {years.map((y) => (
          <option key={y} value={y} className="text-ink">
            {y}
          </option>
        ))}
      </select>
      <select
        aria-label="Session"
        value={known ? (current as string) : ""}
        onChange={(e) => year && e.target.value && onPick({ path: e.target.value, year })}
        className={`${field} min-w-0 max-w-full flex-1 sm:max-w-72`}
      >
        {!known && (
          <option value="" className="text-ink">
            {sessions.length ? "Choose a session…" : "Loading sessions…"}
          </option>
        )}
        {sessions.map((s) => (
          <option key={s.path} value={s.path} className="text-ink">
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Transport for a replay: pause, skip 30 s, speed, a timeline to drag, and jump to a lap or a
 * qualifying segment. All of it just moves the replay clock (framesStore), which every panel
 * reads, so the map, board, telemetry and Race Control stay on the same instant. A seek clears
 * the buffer: the poll loop then fetches around the new position straight away.
 */
export default function ReplayControls({
  info,
  picked,
  onPick,
}: {
  info: ReplayInfo;
  picked: string | null;
  onPick: (pick: ReplayPick) => void;
}) {
  const [pos, setPos] = useState(info.anchorMs);
  const [rate, setRate] = useState(1);
  // The speed to return to on play, kept apart from `rate`, which is 0 while paused.
  const [speed, setSpeed] = useState(1);
  const [dragging, setDragging] = useState<number | null>(null);
  // Nothing buffered around the position yet: just after a jump, while its data is on the way.
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    const tick = () => {
      const now = replayNow();
      // The end of the session: stop there rather than running off the end of the data.
      if (now >= info.durationMs && replayRate() > 0) setReplayClock(info.durationMs, 0);
      setPos(Math.min(now, info.durationMs));
      setRate(replayRate());
      setWaiting(getFrames().length < 2);
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [info.durationMs]);

  const seek = (ms: number) => {
    const to = Math.max(info.anchorMs, Math.min(ms, info.durationMs));
    resetFrames();
    setReplayClock(to, replayRate());
    setPos(to);
  };
  const paused = rate === 0;
  // These read the clock itself: `rate` only refreshes four times a second, so a click right
  // after another would act on the old value.
  const togglePlay = () => {
    const at = replayNow();
    const nowPaused = replayRate() === 0;
    // Play from the end means play again from the start.
    if (nowPaused && at >= info.durationMs) return seekAndPlay(info.anchorMs);
    setReplayClock(at, nowPaused ? speed : 0);
    setRate(nowPaused ? speed : 0);
  };
  const seekAndPlay = (ms: number) => {
    resetFrames();
    setReplayClock(ms, speed);
  };
  const changeSpeed = (v: number) => {
    setSpeed(v);
    if (replayRate() > 0) {
      setReplayClock(replayNow(), v);
      setRate(v);
    }
  };

  const shown = dragging ?? pos;
  const lapNow = [...info.laps].reverse().find((l) => l.ms <= shown)?.lap ?? null;
  const totalLaps = info.laps.at(-1)?.lap ?? 0;
  const segNow = [...info.segments].reverse().find((s) => s.ms <= shown)?.part ?? null;
  const where = lapNow ? `Lap ${lapNow}/${totalLaps}` : segNow ? `Q${segNow}` : "";
  const btn =
    "flex h-8 min-w-8 items-center justify-center rounded-md border border-white/15! px-2 font-mono text-xs font-semibold text-white hover:bg-white/10";

  return (
    <div className="carbon-bg mb-3 flex flex-col gap-2.5 rounded-lg p-3 ring-1 ring-white/10" role="group" aria-label="Replay controls">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn} onClick={() => seek(replayNow() - 30_000)} aria-label="Back 30 seconds">
          −30s
        </button>
        <button
          type="button"
          onClick={togglePlay}
          aria-label={paused ? "Play" : "Pause"}
          className="flex h-8 w-10 items-center justify-center rounded-md bg-red text-white hover:bg-red/90"
        >
          {paused ? (
            <svg viewBox="0 0 12 12" className="h-3 w-3" fill="currentColor" aria-hidden="true">
              <path d="M2 1l9 5-9 5z" />
            </svg>
          ) : (
            <svg viewBox="0 0 12 12" className="h-3 w-3" fill="currentColor" aria-hidden="true">
              <path d="M2 1h3v10H2zM7 1h3v10H7z" />
            </svg>
          )}
        </button>
        <button type="button" className={btn} onClick={() => seek(replayNow() + 30_000)} aria-label="Forward 30 seconds">
          +30s
        </button>
        <div className="flex rounded-md border border-white/15!" role="group" aria-label="Playback speed">
          {SPEEDS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => changeSpeed(v)}
              aria-pressed={speed === v}
              className={`h-8 min-w-8 px-1.5 font-mono text-xs font-semibold ${speed === v ? "bg-white text-ink" : "text-white/70 hover:text-white"}`}
            >
              {v}×
            </button>
          ))}
        </div>
        {info.laps.length > 1 && (
          <select
            aria-label="Jump to lap"
            value=""
            onChange={(e) => e.target.value && seek(Number(e.target.value))}
            className="h-8 rounded-md border border-white/15! bg-white/5 px-2 text-xs text-white"
          >
            <option value="" className="text-ink">
              Jump to lap
            </option>
            {info.laps.map((l) => (
              <option key={l.lap} value={l.ms} className="text-ink">
                Lap {l.lap}
              </option>
            ))}
          </select>
        )}
        {info.segments.map((s) => (
          <button key={s.part} type="button" className={btn} onClick={() => seek(s.ms)} aria-label={`Jump to Q${s.part}`}>
            Q{s.part}
          </button>
        ))}
        <div className="min-w-0 flex-1 sm:ml-auto sm:flex-none">
          <ReplaySessionPicker current={picked ?? info.path} onPick={onPick} />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="tnum shrink-0 font-mono text-xs font-semibold text-white">{where}</span>
        <input
          type="range"
          aria-label="Replay position"
          aria-valuetext={`${where} ${clock(shown - info.anchorMs)}`}
          min={info.anchorMs}
          max={info.durationMs}
          step={1000}
          value={shown}
          onChange={(e) => setDragging(Number(e.target.value))}
          onPointerUp={() => {
            if (dragging != null) seek(dragging);
            setDragging(null);
          }}
          onKeyUp={() => {
            if (dragging != null) seek(dragging);
            setDragging(null);
          }}
          className="h-1.5 min-w-0 flex-1 cursor-pointer accent-red"
        />
        <span className="tnum shrink-0 font-mono text-xs text-white/60">
          {clock(shown - info.anchorMs)} / {clock(info.durationMs - info.anchorMs)}
        </span>
      </div>
      <div className="min-h-4 text-xs text-white/70" role="status">
        {waiting && "Loading this part of the session…"}
      </div>
    </div>
  );
}
