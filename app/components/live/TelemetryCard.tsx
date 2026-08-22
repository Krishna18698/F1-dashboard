"use client";

import { useEffect, useState } from "react";
import { Driver } from "@/lib/openf1";
import { hex } from "@/lib/format";
import { getPlaybackT, getTel } from "./framesStore";

/** Mini-sector status codes — see the note in TimingBoard; 2052 (purple) is still
 *  unconfirmed against live data. Tuned for the dark card background. */
const MINI_SECTOR: Record<number, string> = {
  0: "bg-white/15",
  2048: "bg-white/15",
  2049: "bg-amber-400",
  2051: "bg-emerald-400",
  2052: "bg-violet-400",
  2064: "bg-sky-400",
};

/** F1's colour semantics, on the dark card: purple = fastest anyone, green = personal best. */
function sectorColourOnDark(s?: { overallFastest: boolean; personalFastest: boolean }): string {
  if (!s) return "text-white/50";
  if (s.overallFastest) return "text-violet-400";
  if (s.personalFastest) return "text-emerald-400";
  return "text-white";
}

interface Shown {
  rpm: number;
  speed: number;
  gear: number;
  throttle: number;
}

/**
 * Live telemetry readout for the followed driver — speed / gear / throttle / RPM.
 * Plays the buffered ~4Hz CarData samples back at the map's own delayed clock (via
 * framesStore), interpolating between the bracketing samples — so it updates
 * continuously AND shows the same instant as the dot on screen, on both the token
 * and the free feed.
 */
export default function TelemetryCard({
  num,
  driver,
  onClose,
  sectors,
  speeds,
  showTelemetry = true,
}: {
  num: number;
  driver?: Driver;
  onClose: () => void;
  sectors?: { value: string; overallFastest: boolean; personalFastest: boolean; segments: number[] }[];
  speeds?: Record<string, { value: string; overallFastest: boolean; personalFastest: boolean }>;
  /** CarData is token-gated; without it the live readout is empty, but the SECTORS below
   *  still work (TimingData is ungated) — so the card renders without the telemetry strip
   *  rather than not rendering at all. */
  showTelemetry?: boolean;
}) {
  const [v, setV] = useState<Shown | null>(null);

  useEffect(() => {
    const key = String(num);
    const tick = () => {
      const tel = getTel();
      const pt = getPlaybackT();
      if (!tel.length || !pt) return;
      // Bracket pt (samples are ~250ms apart; scan back from the newest — pt is near the tail).
      let i = tel.length - 1;
      while (i > 0 && tel[i].t > pt) i--;
      const a = tel[i];
      const b = tel[Math.min(i + 1, tel.length - 1)];
      const ca = a.c[key];
      const cb = b.c[key] ?? ca;
      if (!ca) return;
      const f = b.t > a.t ? Math.max(0, Math.min(1, (pt - a.t) / (b.t - a.t))) : 0;
      const next: Shown = {
        rpm: Math.round(ca[0] + (cb[0] - ca[0]) * f),
        speed: Math.round(ca[1] + (cb[1] - ca[1]) * f),
        gear: ca[2],
        throttle: Math.round(ca[3] + (cb[3] - ca[3]) * f),
      };
      setV((cur) =>
        cur && cur.speed === next.speed && cur.gear === next.gear && cur.throttle === next.throttle && cur.rpm === next.rpm
          ? cur
          : next,
      );
    };
    tick();
    const id = setInterval(tick, 120);
    return () => clearInterval(id);
  }, [num]);

  const color = hex(driver?.team_colour);
  const throttle = Math.max(0, Math.min(100, v?.throttle ?? 0));
  // An incremental delta can carry fewer sectors — or fewer mini-sectors within one — than
  // the periodic full snapshot. Rendering the raw arrays made the card visibly jump between
  // one bar and a full set as updates arrived. Lock the bar count to the widest sector this
  // driver has shown (Zandvoort reports 8 per sector) so the layout stays put and only the
  // colours change.
  const segCount = Math.max(8, ...(sectors ?? []).map((x) => x?.segments?.length ?? 0));
  return (
    <div className="carbon-bg mt-3 rounded-lg p-3 ring-1 ring-white/10 sm:p-4">
    <div className="flex items-center gap-4 sm:gap-5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">{driver?.name_acronym ?? "—"}</p>
          <p className="truncate text-[0.65rem] text-white/45">{driver?.team_name}</p>
        </div>
      </div>

      {showTelemetry && (
      <div className="flex flex-1 items-center justify-evenly gap-3">
        <div className="text-center">
          <p className="tnum font-timing text-2xl font-bold leading-none text-white sm:text-3xl">
            {v?.speed ?? "—"}
          </p>
          <p className="eyebrow mt-1 text-[0.5rem] text-white/40">km/h</p>
        </div>
        <div className="text-center">
          <p className="tnum font-timing text-2xl font-bold leading-none text-white sm:text-3xl">
            {v ? v.gear || "N" : "—"}
          </p>
          <p className="eyebrow mt-1 text-[0.5rem] text-white/40">Gear</p>
        </div>
        <div className="hidden text-center sm:block">
          <p className="tnum font-timing text-2xl font-bold leading-none text-white sm:text-3xl">
            {v ? ((v.rpm ?? 0) / 1000).toFixed(1) : "—"}
          </p>
          <p className="eyebrow mt-1 text-[0.5rem] text-white/40">kRPM</p>
        </div>
        {/* Throttle bar */}
        <div className="w-20 sm:w-28">
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-[#3fa34d] transition-[width] duration-150"
              style={{ width: `${throttle}%` }}
            />
          </div>
          <p className="eyebrow mt-1 text-center text-[0.5rem] text-white/40">Throttle {throttle}%</p>
        </div>
      </div>
      )}
      {!showTelemetry && <div className="flex-1" />}

      <button
        onClick={onClose}
        aria-label="Stop following"
        className="shrink-0 rounded-full px-2 py-1 text-white/50 transition-colors hover:text-white"
      >
        ✕
      </button>
    </div>

      {/* Sectors — same card, under the telemetry strip, so the followed driver is one
          self-contained panel instead of a readout here and a sector table across the page. */}
      {!!sectors?.length && (
        <div className={showTelemetry ? "mt-3 border-t border-white/10 pt-3" : ""}>
          <div className="grid grid-cols-3 gap-3">
            {/* Always three slots. A delta can carry only the sector that changed (seen live:
                21 drivers with all three, one with just S1), and rendering the raw array made
                that driver's card collapse to a single lonely column. */}
            {[0, 1, 2].map((i) => sectors[i] ?? { value: "", overallFastest: false, personalFastest: false, segments: [] }).map((sec, i) => (
              <div key={i}>
                <div className="flex items-baseline justify-between gap-1">
                  <span className="eyebrow text-[0.5rem] text-white/40">S{i + 1}</span>
                  <span className={`tnum font-timing text-sm font-bold ${sectorColourOnDark(sec)}`}>
                    {sec.value || "–"}
                  </span>
                </div>
                <div className="mt-1 flex gap-0.5">
                  {Array.from({ length: segCount }, (_, j) => {
                    const code = sec.segments?.[j];
                    return (
                      <span
                        key={j}
                        className={`h-1.5 flex-1 rounded-sm ${code != null ? (MINI_SECTOR[code] ?? "bg-white/15") : "bg-white/10"}`}
                        title={code != null ? `mini-sector ${j + 1} (status ${code})` : `mini-sector ${j + 1}`}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {speeds && (
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
              {["I1", "I2", "FL", "ST"].map((k) => {
                const sp = speeds[k];
                if (!sp?.value) return null;
                return (
                  <span key={k} className="text-[0.55rem] text-white/40">
                    {k}{" "}
                    <span className={`tnum font-timing text-xs font-semibold ${sectorColourOnDark(sp)}`}>
                      {sp.value}
                    </span>
                    <span className="text-[0.5rem]"> km/h</span>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
