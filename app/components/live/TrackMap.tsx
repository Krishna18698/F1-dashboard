"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Driver } from "@/lib/openf1";
import { Bounds, computeBounds, project, rotate, tracePath } from "@/lib/geo";
import { hex } from "@/lib/format";
import { PosFrame } from "./useLiveSession";

const SIZE = 1000;
const DELAY_MS = 10000; // play back this far behind the latest data → smooth, F1-TV-style

interface Circuit {
  x: number[];
  y: number[];
  rotation: number;
  corners: { number: number; x: number; y: number }[];
}

export default function TrackMap({
  circuitKey,
  frames,
  drivers,
  leaderNum,
}: {
  circuitKey?: number;
  frames?: PosFrame[];
  drivers: Map<number, Driver>;
  leaderNum?: number;
}) {
  const [circuit, setCircuit] = useState<Circuit | null>(null);
  const [positions, setPositions] = useState<Record<string, [number, number]>>({});

  // Fetch the real circuit outline once per circuit.
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

  // Rolling buffer of timestamped frames (deduped, ~25s kept).
  const bufRef = useRef<PosFrame[]>([]);
  useEffect(() => {
    if (!frames?.length) return;
    const buf = bufRef.current;
    const seen = new Set(buf.map((f) => f.t));
    for (const f of frames) if (!seen.has(f.t)) buf.push(f);
    buf.sort((a, b) => a.t - b.t);
    const cutoff = (buf.at(-1)?.t ?? 0) - 30_000;
    bufRef.current = buf.filter((f) => f.t >= cutoff);
  }, [frames]);

  // Free-running playback clock: playT = dataAnchor + (real elapsed). It advances at
  // exactly 1× real time (perfectly smooth, no speed-up), and the DELAY buffer absorbs
  // the 3s poll jitter. We only re-anchor if the buffer starves or drifts way out.
  const dataAnchor = useRef<number | null>(null);
  const realAnchor = useRef(0);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const buf = bufRef.current;
      if (buf.length >= 2) {
        const latest = buf[buf.length - 1].t;
        const now = performance.now();
        if (dataAnchor.current === null) {
          dataAnchor.current = latest - DELAY_MS;
          realAnchor.current = now;
        }
        let pt = dataAnchor.current + (now - realAnchor.current);
        const behind = latest - pt;
        if (behind < 2000 || behind > DELAY_MS + 8000) {
          // buffer starving or fell far behind → re-anchor (rare)
          dataAnchor.current = latest - DELAY_MS;
          realAnchor.current = now;
          pt = dataAnchor.current;
        }
        let i = 0;
        while (i < buf.length - 1 && buf[i + 1].t <= pt) i++;
        const a = buf[i];
        const b = buf[Math.min(i + 1, buf.length - 1)];
        const frac = b.t > a.t ? Math.max(0, Math.min(1, (pt - a.t) / (b.t - a.t))) : 0;

        const pos: Record<string, [number, number]> = {};
        for (const n of new Set([...Object.keys(a.c), ...Object.keys(b.c)])) {
          const pa = a.c[n];
          const pb = b.c[n] ?? pa;
          if (pa && pb) pos[n] = [pa[0] + (pb[0] - pa[0]) * frac, pa[1] + (pb[1] - pa[1]) * frac];
          else if (pa) pos[n] = pa;
        }
        setPositions(pos);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const rot = circuit?.rotation ?? 0;
  const outline = useMemo(
    () => (circuit ? rotate(circuit.x.map((x, i) => ({ x, y: circuit.y[i] })), rot) : []),
    [circuit, rot],
  );
  const bounds: Bounds | null = useMemo(() => (outline.length ? computeBounds(outline) : null), [outline]);
  const path = useMemo(() => (bounds ? tracePath(outline, bounds, SIZE) + " Z" : ""), [bounds, outline]);
  const cornerMarks = useMemo(() => {
    if (!circuit || !bounds) return [];
    return rotate(circuit.corners, rot).map((c) => ({ n: c.number, ...project(c.x, c.y, bounds, SIZE) }));
  }, [circuit, rot, bounds]);

  if (!bounds) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-lg carbon-bg text-sm text-white/40">
        Loading circuit…
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

        {cornerMarks.map((c) => (
          <text key={c.n} x={c.cx} y={c.cy} textAnchor="middle" dominantBaseline="middle" fontSize={13} fontWeight={700} fill="rgba(255,255,255,0.35)">
            {c.n}
          </text>
        ))}

        {Object.entries(positions).map(([num, [x, y]]) => {
          const rp = rotate([{ x, y }], rot)[0];
          const { cx, cy } = project(rp.x, rp.y, bounds, SIZE);
          const d = drivers.get(+num);
          const isLeader = +num === leaderNum;
          const color = hex(d?.team_colour);
          const tla = d?.name_acronym ?? num;
          return (
            <g key={num} style={{ transform: `translate(${cx}px, ${cy}px)` }}>
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
