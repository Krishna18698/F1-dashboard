"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Driver } from "@/lib/openf1";
import { Bounds, computeBounds, rotate, tracePath } from "@/lib/geo";
import { hex } from "@/lib/format";
import { getFrames, resetFrames, subscribeFrames } from "./framesStore";

const SIZE = 1000;
const DELAY_MS = 20000; // play back this far behind the latest data → smooth, F1-TV-style

interface Circuit {
  x: number[];
  y: number[];
  rotation: number;
  corners: { number: number; x: number; y: number }[];
}

export default function TrackMap({
  circuitKey,
  drivers,
  leaderNum,
  inPit,
  name,
}: {
  circuitKey?: number;
  drivers: Map<number, Driver>;
  leaderNum?: number;
  inPit?: Set<number>;
  name?: string;
}) {
  const [circuit, setCircuit] = useState<Circuit | null>(null);

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

  // The frame buffer lives in framesStore (fed straight from the poll, no React state).
  // We just hold a live reference to it for the animation loop; resetting on unmount so
  // the next session starts clean.
  const bufRef = useRef(getFrames());
  useEffect(() => {
    bufRef.current = getFrames();
    const unsub = subscribeFrames(() => {
      bufRef.current = getFrames();
    });
    return () => {
      unsub();
      resetFrames();
    };
  }, []);

  const rot = circuit?.rotation ?? 0;
  const outline = useMemo(
    () => (circuit ? rotate(circuit.x.map((x, i) => ({ x, y: circuit.y[i] })), rot) : []),
    [circuit, rot],
  );
  const bounds: Bounds | null = useMemo(() => (outline.length ? computeBounds(outline) : null), [outline]);
  const path = useMemo(() => (bounds ? tracePath(outline, bounds, SIZE) + " Z" : ""), [bounds, outline]);

  // Precompute rotation + projection scalars once (updated when the circuit changes),
  // so the 60fps loop does pure scalar math with ZERO allocations → no GC stutter.
  const projRef = useRef<{
    cos: number;
    sin: number;
    scale: number;
    offX: number;
    offY: number;
    minX: number;
    minY: number;
  } | null>(null);
  useEffect(() => {
    if (!bounds) {
      projRef.current = null;
      return;
    }
    const w = bounds.maxX - bounds.minX || 1;
    const h = bounds.maxY - bounds.minY || 1;
    const scale = Math.min(SIZE / w, SIZE / h);
    const r = (rot * Math.PI) / 180;
    projRef.current = {
      cos: Math.cos(r),
      sin: Math.sin(r),
      scale,
      offX: (SIZE - w * scale) / 2,
      offY: (SIZE - h * scale) / 2,
      minX: bounds.minX,
      minY: bounds.minY,
    };
  }, [bounds, rot]);

  const inPitRef = useRef<Set<number> | undefined>(undefined);
  useEffect(() => {
    inPitRef.current = inPit;
  }, [inPit]);

  // Positions are updated IMPERATIVELY (no React re-render per frame).
  const dotsGroupRef = useRef<SVGGElement>(null);
  const ptRef = useRef<number | null>(null);
  const lastNow = useRef(0);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const buf = bufRef.current;
      const proj = projRef.current;
      const group = dotsGroupRef.current;
      if (buf.length >= 2 && proj && group) {
        const latest = buf[buf.length - 1].t;
        const now = performance.now();
        const dt = now - lastNow.current;
        lastNow.current = now;
        if (ptRef.current === null || dt > 1500 || latest - ptRef.current > 40000) {
          // startup / tab was hidden / hopelessly behind → snap (rare)
          ptRef.current = latest - DELAY_MS;
        } else {
          // Free-run at EXACTLY 1x for constant, smooth motion. Only nudge the rate
          // (±5%) when the lag leaves a wide deadzone around DELAY — which normally never
          // happens, so there is no speed pulse on each 3s poll. (The old bug corrected
          // toward `latest`, which staircases every poll, causing periodic speed-ups.)
          const err = latest - ptRef.current - DELAY_MS; // + = too much lag, - = too little
          const DEAD = 8000;
          let rate = 1;
          if (Math.abs(err) > DEAD) {
            const over = err - Math.sign(err) * DEAD;
            rate = 1 + Math.max(-0.05, Math.min(0.05, over / 12000));
          }
          ptRef.current += dt * rate;
          if (ptRef.current > latest) ptRef.current = latest; // never overrun the newest frame
        }
        const pt = ptRef.current;

        let i = 0;
        while (i < buf.length - 1 && buf[i + 1].t <= pt) i++;
        const a = buf[i];
        const c = buf[Math.min(i + 1, buf.length - 1)];
        const frac = c.t > a.t ? Math.max(0, Math.min(1, (pt - a.t) / (c.t - a.t))) : 0;
        const { cos, sin, scale, offX, offY, minX, minY } = proj;
        const pits = inPitRef.current;

        const kids = group.children;
        for (let k = 0; k < kids.length; k++) {
          const el = kids[k] as SVGGElement;
          const num = +el.dataset.num!;
          const pa = a.c[num];
          if (!pa || pits?.has(num)) {
            el.style.visibility = "hidden";
            continue;
          }
          const pb = c.c[num] ?? pa;
          const x = pa[0] + (pb[0] - pa[0]) * frac;
          const y = pa[1] + (pb[1] - pa[1]) * frac;
          const rx = x * cos - y * sin;
          const ry = x * sin + y * cos;
          const cx = offX + (rx - minX) * scale;
          const cy = SIZE - (offY + (ry - minY) * scale);
          el.setAttribute("transform", `translate(${cx.toFixed(1)} ${cy.toFixed(1)})`);
          el.style.visibility = "visible";
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Dot structure is memoized on a STABLE key (numbers/colours/leader) so it renders
  // once and doesn't churn every poll — the loop above just moves each <g>.
  const dotsKey = useMemo(
    () =>
      [...drivers.keys()]
        .sort((a, b) => a - b)
        .map((n) => `${n}:${drivers.get(n)?.team_colour}:${drivers.get(n)?.name_acronym}:${n === leaderNum}`)
        .join("|"),
    [drivers, leaderNum],
  );
  const dots = useMemo(() => {
    return [...drivers.keys()].map((num) => {
      const d = drivers.get(num);
      const color = hex(d?.team_colour);
      const isLeader = num === leaderNum;
      return (
        <g key={num} data-num={num} style={{ visibility: "hidden" }}>
          {isLeader && <circle r={20} fill={color} opacity={0.3} />}
          <circle r={isLeader ? 14 : 11} fill={color} stroke="#15151a" strokeWidth={isLeader ? 3 : 2} />
          <g transform="translate(0, -30)">
            <rect x={-26} y={-15} width={52} height={26} rx={5} fill="#15151a" stroke={color} strokeWidth={2} />
            <text x={0} y={3} textAnchor="middle" fontSize={17} fontWeight={800} fill="#fff" fontFamily="var(--font-geist-sans), sans-serif">
              {d?.name_acronym ?? num}
            </text>
          </g>
        </g>
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dotsKey]);

  if (!bounds) {
    return (
      <div className="flex aspect-square items-center justify-center self-start rounded-lg carbon-bg text-sm text-white/40">
        Loading circuit…
      </div>
    );
  }

  return (
    <div className="relative aspect-square self-start overflow-hidden rounded-lg carbon-bg ring-1 ring-white/10">
      {name && (
        <span className="eyebrow absolute bottom-3 left-4 z-10 text-[0.7rem] font-semibold text-white/50">
          {name}
        </span>
      )}
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full">
        {path && (
          <path d={path} fill="none" stroke="#f4f4f6" strokeWidth={12} strokeLinejoin="round" strokeLinecap="round" />
        )}
        <g ref={dotsGroupRef}>{dots}</g>
      </svg>
    </div>
  );
}
