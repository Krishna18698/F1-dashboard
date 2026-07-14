"use client";

import { Driver } from "@/lib/openf1";
import { hex } from "@/lib/format";

export interface Telemetry {
  rpm: number;
  speed: number;
  gear: number;
  throttle: number;
}

/** Compact telemetry readout for the selected (followed) driver — speed / gear / throttle / RPM. */
export default function TelemetryCard({
  driver,
  telemetry,
  onClose,
}: {
  driver?: Driver;
  telemetry?: Telemetry;
  onClose: () => void;
}) {
  const color = hex(driver?.team_colour);
  const throttle = Math.max(0, Math.min(100, telemetry?.throttle ?? 0));
  return (
    <div className="carbon-bg mt-3 flex items-center gap-4 rounded-lg p-3 ring-1 ring-white/10 sm:gap-5 sm:p-4">
      <div className="flex min-w-0 items-center gap-2">
        <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">{driver?.name_acronym ?? "—"}</p>
          <p className="truncate text-[0.65rem] text-white/45">{driver?.team_name}</p>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-evenly gap-3">
        <div className="text-center">
          <p className="tnum font-mono text-2xl font-bold leading-none text-white sm:text-3xl">
            {telemetry?.speed ?? 0}
          </p>
          <p className="eyebrow mt-1 text-[0.5rem] text-white/40">km/h</p>
        </div>
        <div className="text-center">
          <p className="tnum font-mono text-2xl font-bold leading-none text-white sm:text-3xl">
            {telemetry?.gear || "N"}
          </p>
          <p className="eyebrow mt-1 text-[0.5rem] text-white/40">Gear</p>
        </div>
        <div className="hidden text-center sm:block">
          <p className="tnum font-mono text-2xl font-bold leading-none text-white sm:text-3xl">
            {((telemetry?.rpm ?? 0) / 1000).toFixed(1)}
          </p>
          <p className="eyebrow mt-1 text-[0.5rem] text-white/40">kRPM</p>
        </div>
        {/* Throttle bar */}
        <div className="w-20 sm:w-28">
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-[#3fa34d] transition-[width] duration-500"
              style={{ width: `${throttle}%` }}
            />
          </div>
          <p className="eyebrow mt-1 text-center text-[0.5rem] text-white/40">Throttle {throttle}%</p>
        </div>
      </div>

      <button
        onClick={onClose}
        aria-label="Stop following"
        className="shrink-0 rounded-full px-2 py-1 text-white/50 transition-colors hover:text-white"
      >
        ✕
      </button>
    </div>
  );
}
