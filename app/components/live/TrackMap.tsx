"use client";

import { useMemo } from "react";
import { Driver, LocationRow } from "@/lib/openf1";
import { computeBounds, project, tracePath } from "@/lib/geo";
import { hex } from "@/lib/format";

const SIZE = 1000;

export default function TrackMap({
  trace,
  locations,
  drivers,
  leaderNum,
}: {
  trace: { x: number; y: number }[];
  locations: Map<number, LocationRow>;
  drivers: Map<number, Driver>;
  leaderNum?: number;
}) {
  const cars = [...locations.values()].filter((c) => c.x !== 0 || c.y !== 0);

  // Bounds from the outline plus current cars, so nothing clips off-screen.
  const bounds = useMemo(() => {
    const pts = trace.length ? trace : cars.map((c) => ({ x: c.x, y: c.y }));
    return pts.length ? computeBounds(pts) : null;
  }, [trace, cars]);

  const path = useMemo(
    () => (bounds && trace.length ? tracePath(trace, bounds, SIZE) : ""),
    [bounds, trace],
  );

  if (!bounds) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-lg carbon-bg text-sm text-white/40">
        Acquiring track map…
      </div>
    );
  }

  return (
    <div className="carbon-bg overflow-hidden rounded-lg ring-1 ring-white/10">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full">
        {/* Track ribbon */}
        {path && (
          <>
            <path
              d={path}
              fill="none"
              stroke="rgba(255,255,255,0.10)"
              strokeWidth={26}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <path
              d={path}
              fill="none"
              stroke="rgba(255,255,255,0.35)"
              strokeWidth={3}
              strokeDasharray="2 10"
              strokeLinecap="round"
            />
          </>
        )}

        {/* Cars */}
        {cars.map((c) => {
          const { cx, cy } = project(c.x, c.y, bounds, SIZE);
          const d = drivers.get(c.driver_number);
          const isLeader = c.driver_number === leaderNum;
          return (
            <g
              key={c.driver_number}
              className="car-dot"
              style={{ transform: `translate(${cx}px, ${cy}px)` }}
            >
              <circle
                r={isLeader ? 15 : 11}
                fill={hex(d?.team_colour)}
                stroke="#fff"
                strokeWidth={isLeader ? 3 : 2}
              />
              <text
                x={0}
                y={-20}
                textAnchor="middle"
                fontSize={22}
                fontWeight={700}
                fill="#fff"
                style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,0.6)", strokeWidth: 4 }}
              >
                {d?.name_acronym ?? c.driver_number}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
