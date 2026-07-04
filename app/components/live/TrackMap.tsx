"use client";

import { useEffect, useMemo, useState } from "react";
import { Driver, LocationRow } from "@/lib/openf1";
import { Bounds, computeBounds, project, rotate, tracePath } from "@/lib/geo";
import { hex } from "@/lib/format";

const SIZE = 1000;

interface Circuit {
  x: number[];
  y: number[];
  rotation: number;
  corners: { number: number; x: number; y: number }[];
}

export default function TrackMap({
  circuitKey,
  trace,
  locations,
  drivers,
  leaderNum,
}: {
  circuitKey?: number;
  trace: { x: number; y: number }[];
  locations: Map<number, LocationRow>;
  drivers: Map<number, Driver>;
  leaderNum?: number;
}) {
  const [circuit, setCircuit] = useState<Circuit | null>(null);

  // Fetch the real circuit outline once per circuit (cached server-side).
  useEffect(() => {
    if (!circuitKey) return;
    let on = true;
    fetch(`/api/circuit?key=${circuitKey}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => on && d?.x?.length && setCircuit(d))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [circuitKey]);

  const cars = [...locations.values()].filter((c) => c.x !== 0 || c.y !== 0);
  const rot = circuit?.rotation ?? 0;

  // Outline points (rotated to the canonical orientation the circuit data ships with).
  const outline = useMemo(() => {
    if (circuit) return rotate(circuit.x.map((x, i) => ({ x, y: circuit.y[i] })), rot);
    return trace; // fallback: derived path until the circuit loads
  }, [circuit, rot, trace]);

  const bounds: Bounds | null = useMemo(() => {
    const pts = outline.length ? outline : cars.map((c) => ({ x: c.x, y: c.y }));
    return pts.length ? computeBounds(pts) : null;
  }, [outline, cars]);

  const path = useMemo(
    () => (bounds && outline.length ? tracePath(outline, bounds, SIZE) + (circuit ? " Z" : "") : ""),
    [bounds, outline, circuit],
  );

  const cornerMarks = useMemo(() => {
    if (!circuit || !bounds) return [];
    return rotate(circuit.corners, rot).map((c) => ({ n: c.number, ...project(c.x, c.y, bounds, SIZE) }));
  }, [circuit, rot, bounds]);

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
        {path && (
          <>
            <path d={path} fill="none" stroke="#26262c" strokeWidth={34} strokeLinejoin="round" strokeLinecap="round" />
            <path d={path} fill="none" stroke="#3a3a42" strokeWidth={28} strokeLinejoin="round" strokeLinecap="round" />
            <path d={path} fill="none" stroke="#e10600" strokeWidth={3} strokeDasharray="1 14" strokeLinecap="round" opacity={0.85} />
          </>
        )}

        {/* Corner numbers */}
        {cornerMarks.map((c) => (
          <text
            key={c.n}
            x={c.cx}
            y={c.cy}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={13}
            fontWeight={700}
            fill="rgba(255,255,255,0.35)"
          >
            {c.n}
          </text>
        ))}

        {/* Cars */}
        {cars.map((c) => {
          const rp = rotate([{ x: c.x, y: c.y }], rot)[0];
          const { cx, cy } = project(rp.x, rp.y, bounds, SIZE);
          const d = drivers.get(c.driver_number);
          const isLeader = c.driver_number === leaderNum;
          const color = hex(d?.team_colour);
          const tla = d?.name_acronym ?? String(c.driver_number);
          return (
            <g key={c.driver_number} className="car-dot" style={{ transform: `translate(${cx}px, ${cy}px)` }}>
              {isLeader && <circle r={20} fill={color} opacity={0.25} />}
              <circle r={isLeader ? 15 : 12} fill={color} stroke="#fff" strokeWidth={isLeader ? 3.5 : 2.5} />
              <g transform="translate(0, -30)">
                <rect x={-26} y={-15} width={52} height={26} rx={5} fill="#15151a" stroke={color} strokeWidth={2} />
                <text x={0} y={3} textAnchor="middle" fontSize={17} fontWeight={800} fill="#fff" fontFamily="var(--font-geist-sans), sans-serif">
                  {tla}
                </text>
              </g>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
