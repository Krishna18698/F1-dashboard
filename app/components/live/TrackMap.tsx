"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Driver } from "@/lib/openf1";
import { Bounds, computeBounds, rotate, tracePath } from "@/lib/geo";
import { hex } from "@/lib/format";
import { trackStatusInfo } from "@/lib/trackStatus";
import { getFrames, resetFrames, subscribeFrames } from "./framesStore";

const SIZE = 1000;
const DELAY_MS = 20000; // play back this far behind the latest data → smooth, F1-TV-style

interface Circuit {
  x: number[];
  y: number[];
  rotation: number;
  corners: { number: number; x: number; y: number; angle?: number }[];
}

export default function TrackMap({
  circuitKey,
  drivers,
  leaderNum,
  inPit,
  retired,
  name,
  trackStatus,
  selectedNum,
  onSelect,
}: {
  circuitKey?: number;
  drivers: Map<number, Driver>;
  leaderNum?: number;
  inPit?: Set<number>;
  retired?: Set<number>;
  name?: string;
  trackStatus?: string | null;
  selectedNum?: number | null;
  onSelect?: (num: number | null) => void;
}) {
  const [circuit, setCircuit] = useState<Circuit | null>(null);

  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!circuitKey) return;
    let on = true;
    fetch(`/api/circuit?key=${circuitKey}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!on) return;
        if (d?.x?.length) {
          setCircuit(d);
          setFailed(false);
        } else {
          setFailed(true); // MultiViewer has no outline (e.g. a brand-new circuit)
        }
      })
      .catch(() => on && setFailed(true));
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

  // Corner numbers, sitting just OUTSIDE the track line: project each corner to screen
  // coords, then push it ~26px along the corner's outward angle (from MultiViewer).
  const cornerLabels = useMemo(() => {
    if (!circuit?.corners?.length || !bounds) return [];
    const w = bounds.maxX - bounds.minX || 1;
    const h = bounds.maxY - bounds.minY || 1;
    const scale = Math.min(SIZE / w, SIZE / h);
    const offX = (SIZE - w * scale) / 2;
    const offY = (SIZE - h * scale) / 2;
    const r = (rot * Math.PI) / 180;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    // Driver tags float a FIXED distance above each dot in screen space (see the dot's
    // own `translate(0,-27)` below), while corner numbers sit a track-relative distance
    // outward — so on some corners the two land in the same screen spot. Push numbers
    // further out so they clear the tags' ~22px-tall footprint in the common case.
    const OFF = 42;
    return circuit.corners.map((c) => {
      const rx = c.x * cos - c.y * sin;
      const ry = c.x * sin + c.y * cos;
      const cx = offX + (rx - bounds.minX) * scale;
      const cy = SIZE - (offY + (ry - bounds.minY) * scale);
      const a = ((c.angle ?? 0) * Math.PI) / 180;
      const dx = Math.cos(a) * cos - Math.sin(a) * sin;
      const dy = Math.cos(a) * sin + Math.sin(a) * cos;
      return { n: c.number, x: cx + dx * OFF, y: cy - dy * OFF };
    });
  }, [circuit, bounds, rot]);

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
  const retiredRef = useRef<Set<number> | undefined>(undefined);
  useEffect(() => {
    retiredRef.current = retired;
  }, [retired]);
  const selRef = useRef<number | null>(null);
  useEffect(() => {
    selRef.current = selectedNum ?? null;
  }, [selectedNum]);
  // Per-car smoothed screen position (EMA) — the raw GPS samples carry speed noise
  // (~28% of consecutive samples imply >60% speed jumps), so rendering them faithfully
  // makes dots surge/slow. Entries allocated once per car, then mutated in place.
  const smoothRef = useRef(new Map<number, { x: number; y: number; shown: boolean }>());

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
          // First frame / tab was hidden / fell to the buffer's edge → (re)anchor. Rare.
          ptRef.current = latest - DELAY_MS;
        } else {
          // Advance the render clock at EXACTLY real time — NEVER correct its rate. Playback
          // speed is therefore perfectly constant; interpolation between the bracketing
          // frames absorbs all network jitter. (This is "renderTime = clock − delay", but
          // driven by a monotonic timer and anchored to the data's own timestamps, so a
          // skewed system clock can't break it.) If we catch up to the newest frame because
          // data stalled, hold there instead of jumping backwards.
          ptRef.current += dt;
          if (ptRef.current > latest) ptRef.current = latest;
        }
        const pt = ptRef.current;

        let i = 0;
        while (i < buf.length - 1 && buf[i + 1].t <= pt) i++;
        const a = buf[i];
        const c = buf[Math.min(i + 1, buf.length - 1)];
        // Neighbours for Catmull-Rom (clamped at buffer edges → degenerates to ~linear).
        const p0f = buf[Math.max(0, i - 1)];
        const p3f = buf[Math.min(i + 2, buf.length - 1)];
        const frac = c.t > a.t ? Math.max(0, Math.min(1, (pt - a.t) / (c.t - a.t))) : 0;
        const t2 = frac * frac;
        const t3 = t2 * frac;
        // Uniform Catmull-Rom basis weights (precomputed once per frame, shared by all cars).
        const w0 = -0.5 * t3 + t2 - 0.5 * frac;
        const w1 = 1.5 * t3 - 2.5 * t2 + 1;
        const w2 = -1.5 * t3 + 2 * t2 + 0.5 * frac;
        const w3 = 0.5 * t3 - 0.5 * t2;
        const { cos, sin, scale, offX, offY, minX, minY } = proj;
        const pits = inPitRef.current;
        const outs = retiredRef.current;
        const sel = selRef.current;
        const smooth = smoothRef.current;
        // EMA weight for this frame (τ = 300ms): filters the feed's sample-to-sample speed
        // noise so dots hold steady pace instead of surging/slowing with GPS jitter.
        const ema = 1 - Math.exp(-dt / 300);

        const kids = group.children;
        for (let k = 0; k < kids.length; k++) {
          const el = kids[k] as SVGGElement;
          const num = +el.dataset.num!;
          const pa = a.c[num];
          const st = smooth.get(num);
          if (!pa || pits?.has(num) || outs?.has(num)) {
            el.style.visibility = "hidden";
            if (st) st.shown = false; // snap (not glide) when it reappears
            continue;
          }
          const pb = c.c[num] ?? pa;
          // Catmull-Rom through the 4 bracketing GPS points → dots sweep smoothly through
          // corners instead of polygon-ing. Missing neighbours fall back to the segment ends.
          const q0 = p0f.c[num] ?? pa;
          const q3 = p3f.c[num] ?? pb;
          const x = w0 * q0[0] + w1 * pa[0] + w2 * pb[0] + w3 * q3[0];
          const y = w0 * q0[1] + w1 * pa[1] + w2 * pb[1] + w3 * q3[1];
          const rx = x * cos - y * sin;
          const ry = x * sin + y * cos;
          const cx = offX + (rx - minX) * scale;
          const cy = SIZE - (offY + (ry - minY) * scale);

          // Low-pass the rendered position; snap on first show or a big jump (pit exit).
          let sx = cx;
          let sy = cy;
          if (st) {
            const dx = cx - st.x;
            const dy = cy - st.y;
            if (st.shown && dx * dx + dy * dy < 3600) {
              st.x += dx * ema;
              st.y += dy * ema;
            } else {
              st.x = cx;
              st.y = cy;
            }
            st.shown = true;
            sx = st.x;
            sy = st.y;
          } else {
            smooth.set(num, { x: cx, y: cy, shown: true });
          }

          el.setAttribute("transform", `translate(${sx.toFixed(1)} ${sy.toFixed(1)})`);
          el.style.visibility = "visible";
          // Click-to-follow: dim everyone except the selected driver.
          el.style.opacity = sel == null || sel === num ? "1" : "0.3";
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
        .map((n) => `${n}:${drivers.get(n)?.team_colour}:${drivers.get(n)?.name_acronym}:${n === leaderNum}:${n === selectedNum}`)
        .join("|"),
    [drivers, leaderNum, selectedNum],
  );
  const dots = useMemo(() => {
    return [...drivers.keys()].map((num) => {
      const d = drivers.get(num);
      const color = hex(d?.team_colour);
      const isLeader = num === leaderNum;
      const isSel = num === selectedNum;
      return (
        <g
          key={num}
          data-num={num}
          style={{ visibility: "hidden", cursor: "pointer", transition: "opacity 0.25s" }}
          onClick={() => onSelect?.(isSel ? null : num)}
        >
          {isSel && <circle r={22} fill="none" stroke="#ffffff" strokeWidth={3} opacity={0.9} />}
          {isLeader && <circle r={20} fill={color} opacity={0.3} />}
          <circle r={isLeader ? 14 : 11} fill={color} stroke="#15151a" strokeWidth={isLeader ? 3 : 2} />
          <g transform="translate(0, -27)">
            <rect x={-22} y={-13} width={44} height={22} rx={4} fill="#15151a" stroke={isSel ? "#fff" : color} strokeWidth={2} />
            <text x={0} y={2.5} textAnchor="middle" fontSize={14} fontWeight={800} fill="#fff" fontFamily="var(--font-geist-sans), sans-serif">
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
      <div className="self-start">
        <span className="eyebrow mb-2 block text-[0.6rem] text-muted">
          Driver <span className="text-red">Tracker</span>
        </span>
        {failed ? (
          <div className="flex aspect-square items-center justify-center rounded-lg carbon-bg px-6 text-center text-sm text-white/40">
            Track outline unavailable for this circuit — timing &amp; tyres below still update live.
          </div>
        ) : (
          <div className="relative aspect-square overflow-hidden rounded-lg carbon-bg ring-1 ring-white/10">
            <div className="skeleton-dark absolute inset-6 rounded-full opacity-60" />
            <span className="absolute inset-0 flex items-center justify-center text-sm text-white/40">
              Loading circuit…
            </span>
          </div>
        )}
      </div>
    );
  }

  // Track-status tint: yellow / SC-orange / red glow around the map while not clear.
  const ts = trackStatusInfo(trackStatus ?? undefined);
  const tinted = !!trackStatus && !ts.calm;

  return (
    <div className="self-start">
      <span className="eyebrow mb-2 block text-[0.6rem] text-muted">
        Driver <span className="text-red">Tracker</span>
      </span>
      <div
        className="relative aspect-square overflow-hidden rounded-lg carbon-bg ring-1 ring-white/10"
        style={{
          boxShadow: tinted ? `inset 0 0 0 3px ${ts.color}, inset 0 0 60px ${ts.color}33` : "none",
          transition: "box-shadow 0.6s ease",
        }}
      >
        {tinted && (
          <span
            className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.6rem] font-bold tracking-wider"
            style={{ backgroundColor: ts.color, color: trackStatus === "2" || trackStatus === "7" ? "#15151a" : "#fff" }}
          >
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-current" />
            {ts.label.toUpperCase()}
          </span>
        )}
        {name && (
          <span className="eyebrow absolute bottom-3 left-4 z-10 text-[0.7rem] font-semibold text-white/50">
            {name}
          </span>
        )}
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full">
          {path && (
            <path d={path} fill="none" stroke="#f4f4f6" strokeWidth={12} strokeLinejoin="round" strokeLinecap="round" />
          )}
          {cornerLabels.map((c) => (
            <g key={c.n} transform={`translate(${c.x} ${c.y})`}>
              <circle r={12} fill="#15151a" fillOpacity={0.75} />
              <text
                textAnchor="middle"
                dominantBaseline="central"
                y={0.5}
                fontSize={20}
                fontWeight={800}
                fill="#c9c9d1"
                fontFamily="var(--font-geist-mono), monospace"
              >
                {c.n}
              </text>
            </g>
          ))}
          <g ref={dotsGroupRef}>{dots}</g>
        </svg>
      </div>
    </div>
  );
}
