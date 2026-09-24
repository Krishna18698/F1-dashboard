"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Driver } from "@/lib/timingTypes";
import { SessionMode } from "./liveTypes";
import { Bounds, computeBounds, project, rotate, tracePath } from "@/lib/geo";
import { hex } from "@/lib/format";
import { trackStatusInfo } from "@/lib/trackStatus";
import { getFrames, resetFrames, setPlaybackT, subscribeFrames, useHasFrames } from "./framesStore";

const SIZE = 1000;

const DELAY_MS = 20000; // play back this far behind the latest data → smooth, F1-TV-style

// Heat trail behind the selected car: TRAIL_SEGMENTS pieces, one per TRAIL_STEP_MS of playback,
// so ~8 s of track. Hot orange at the car, cooling to red and fading out at the tail.
const TRAIL_SEGMENTS = 16;
const TRAIL_STEP_MS = 500;
// Same threshold the dots use to decide a move is a snap (pit exit, reappearance), not motion.
const TRAIL_JUMP_SQ = 3600;
const trailStyle = Array.from({ length: TRAIL_SEGMENTS }, (_, k) => {
  const f = k / (TRAIL_SEGMENTS - 1);
  const g = Math.round(0x8a + (0x06 - 0x8a) * f);
  const r = Math.round(0xff + (0xe1 - 0xff) * f);
  return {
    stroke: `rgb(${r},${g},0)`,
    width: 10 - 7 * f,
    opacity: Math.pow(1 - k / TRAIL_SEGMENTS, 1.5),
  };
});

type Frames = { t: number; c: Record<string, [number, number]> }[];
/** Scratch output for sampleCar, reused so the animation loop never allocates. */
const sampled: [number, number] = [0, 0];
/**
 * One car's position at playback time `t`, with the same Catmull-Rom the dots use, written into
 * `sampled`. False when `t` is outside the buffer or the car is missing from a bracketing frame.
 */
function sampleCar(buf: Frames, num: number, t: number): boolean {
  if (buf.length < 2 || t < buf[0].t || t > buf[buf.length - 1].t) return false;
  let lo = 0;
  let hi = buf.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (buf[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = buf[lo];
  const c = buf[hi];
  const pa = a.c[num];
  if (!pa) return false;
  const pb = c.c[num] ?? pa;
  const q0 = buf[Math.max(0, lo - 1)].c[num] ?? pa;
  const q3 = buf[Math.min(hi + 1, buf.length - 1)].c[num] ?? pb;
  const u = c.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (c.t - a.t))) : 0;
  const u2 = u * u;
  const u3 = u2 * u;
  const w0 = -0.5 * u3 + u2 - 0.5 * u;
  const w1 = 1.5 * u3 - 2.5 * u2 + 1;
  const w2 = -1.5 * u3 + 2 * u2 + 0.5 * u;
  const w3 = 0.5 * u3 - 0.5 * u2;
  sampled[0] = w0 * q0[0] + w1 * pa[0] + w2 * pb[0] + w3 * q3[0];
  sampled[1] = w0 * q0[1] + w1 * pa[1] + w2 * pb[1] + w3 * q3[1];
  return true;
}

interface Circuit {
  x: number[];
  y: number[];
  rotation: number;
  /** `number` is what MultiViewer publishes; `label` carries an organiser's lettered turn
   *  (Madrid's 5A / 20A), which a bare number cannot express. Render prefers label. */
  corners: { number: number; label?: string; x: number; y: number; angle?: number }[];
}

export default function TrackMap({
  circuitKey,
  drivers,
  leaderNum,
  inPit,
  lapCounts,
  retired,
  name,
  trackStatus,
  formationLap,
  suspended,
  mode,
  laps,
  clock,
  selectedNum,
  onSelect,
}: {
  circuitKey?: number;
  drivers: Map<number, Driver>;
  leaderNum?: number;
  /** Completed laps per driver — the traced car's counter ticking over marks the start/finish
   *  line, which is where corner numbering has to begin. */
  lapCounts?: Map<number, { count: number }>;
  inPit?: Set<number>;
  retired?: Set<number>;
  name?: string;
  trackStatus?: string | null;
  formationLap?: boolean;
  /** Session is red-flagged (SessionStatus "Aborted") — outranks every other tint. */
  suspended?: boolean;
  /** Only a race gets "suspended" — practice and qualifying are stopped, not suspended. */
  mode?: SessionMode;
  laps?: { current: number; total: number };
  /** Practice / qualifying session clock, already ticking (shared with the timing board). A
   *  race has none: it is measured in laps, which the LAP chip in the same corner shows. */
  clock?: { label: string; value: string } | null;
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

  // MultiViewer has no outline for a brand-new circuit — Madrid (key 153) returns 404 for
  // every year, while Monza returns 200, so the API is fine and the circuit simply is not in
  // it. Rather than show nothing, trace the track from the cars themselves: their positions
  // ARE the circuit, and they arrive in exactly the coordinate space the dots are drawn in,
  // so a derived outline aligns by construction — no rotation, no scaling, nothing to guess.
  //
  // Feeding it back through `setCircuit` means bounds, the path and every dot keep using the
  // one code path; a derived circuit differs only in having no corner numbers to label.
  const traceRef = useRef<{
    num: string | null;
    pts: { x: number; y: number }[];
    lastT: number;
    closed: boolean;
    startIdx: number | null;
    lapSeen: number | null;
  }>({ num: null, pts: [], lastT: -Infinity, closed: false, startIdx: null, lapSeen: null });
  // Read inside the frame callback rather than as an effect dependency: lapCounts is a fresh
  // Map every poll, and depending on it would tear down and rebuild the subscription each time.
  const lapsRef = useRef(lapCounts);
  useEffect(() => {
    lapsRef.current = lapCounts;
  });
  useEffect(() => {
    if (!failed || !circuitKey) return;
    const t = traceRef.current;
    if (!t.closed) {
      try {
        const cached = localStorage.getItem(`pitwall:outline:v2:${circuitKey}`);
        const parsed = cached ? (JSON.parse(cached) as Circuit) : null;
        if (parsed?.x?.length) {
          t.closed = true;
          // Deferred out of the effect body, same idiom as MyTokenCard — this ends in setState.
          const seed = setTimeout(() => setCircuit(parsed), 0);
          return () => clearTimeout(seed);
        }
      } catch {}
    }
    const absorb = () => {
      if (t.closed) return;
      for (const f of getFrames()) {
        if (f.t <= t.lastT) continue;
        t.lastT = f.t;
        // Lock onto one car and stay with it: two cars take slightly different lines, so
        // mixing them would zigzag the outline between them.
        if (t.num == null) {
          t.num = Object.keys(f.c).find((n) => !inPit?.has(Number(n))) ?? null;
          if (t.num == null) continue;
        }
        // Skip the pit lane — it is not part of the circuit and would hang a spur off it.
        if (inPit?.has(Number(t.num))) continue;
        const p = f.c[t.num];
        if (!p) continue;
        // The traced car's lap counter ticking over IS the start/finish line, to within one
        // sample. Corner numbering runs from there, so remember where in the trace it fell.
        const lap = lapsRef.current?.get(Number(t.num))?.count ?? null;
        if (lap != null) {
          if (t.lapSeen != null && lap !== t.lapSeen) t.startIdx = t.pts.length;
          t.lapSeen = lap;
        }
        t.pts.push({ x: p[0], y: p[1] });
      }
      if (t.pts.length < 30) return;
      // Stop at one clean lap: once the car comes back near where tracing began, further laps
      // would only overlay a slightly different racing line on the same track. Threshold is a
      // fraction of the figure's own size, so it needs no assumption about the feed's units.
      const xs = t.pts.map((q) => q.x);
      const ys = t.pts.map((q) => q.y);
      void xs;
      void ys;
      const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      const head = t.pts[0];
      const tail = t.pts[t.pts.length - 1];
      if (!(t.pts.length > 120 && Math.hypot(tail.x - head.x, tail.y - head.y) < diag * 0.04)) return;
      // Only publish a COMPLETED lap. Showing it grow point by point read as the page being
      // broken rather than as a map loading, and a half-drawn circuit is worse than the
      // skeleton it replaces — so accumulate silently and reveal once, finished.
      t.closed = true;
      // Rotate the loop so it begins at the start/finish line before numbering anything.
      const ordered =
        t.startIdx != null ? [...t.pts.slice(t.startIdx), ...t.pts.slice(0, t.startIdx)] : t.pts;
      const derived = {
        x: ordered.map((q) => q.x),
        y: ordered.map((q) => q.y),
        rotation: 0,
        // No corner numbers on a traced circuit, deliberately. Curvature can find WHERE the
        // track bends, but not which bend is which: on Madrid the detected turns ranged from
        // 11 to 97 degrees, so the weak ones are kinks on a straight while real corners get
        // merged. A run that happened to total 24 — Madrid's official label count — did so by
        // cancelling errors, not by being right, and tuning until it matched would only move
        // the failure to the next new circuit. A number in the wrong place is worse than no
        // number, so the outline stands on its own until a source publishes real corner data.
        corners: [],
      };
      setCircuit(derived);
      // Remember it: tracing costs a full lap of watching, and without this every reload and
      // every later session at the same circuit pays that again.
      try {
        localStorage.setItem(`pitwall:outline:v2:${circuitKey}`, JSON.stringify(derived));
      } catch {}
    };
    absorb();
    const unsub = subscribeFrames(absorb);
    return unsub;
  }, [failed, inPit, circuitKey]);

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
  // Reactive (unlike the ref above) — the animation loop needs 2+ frames to interpolate a
  // position, which usually only exists after the SECOND poll (driver identities arrive on
  // the first), so gating the skeleton on driver data alone still let an empty track show
  // for one whole poll interval before any dot had real coordinates. Shared with
  // RaceControl's reveal timing (via LiveSection) so both agree on "tracking is really up".
  const hasFrames = useHasFrames();

  const rot = circuit?.rotation ?? 0;
  const outline = useMemo(
    () => (circuit ? rotate(circuit.x.map((x, i) => ({ x, y: circuit.y[i] })), rot) : []),
    [circuit, rot],
  );
  const bounds: Bounds | null = useMemo(() => (outline.length ? computeBounds(outline) : null), [outline]);
  const path = useMemo(() => (bounds ? tracePath(outline, bounds, SIZE) + " Z" : ""), [bounds, outline]);
  // Start/finish line. Every outline we draw begins AT the timing line: MultiViewer's comes from
  // a `candidateLap` traced from lap start, and ours are cut at the lap-counter tick — so
  // point 0 is the line. Drawn perpendicular to the track's direction there, as a short
  // chequered bar that spans a little wider than the track stroke.
  const startFinish = useMemo(() => {
    if (!bounds || outline.length < 8) return null;
    const a = project(outline[0].x, outline[0].y, bounds, SIZE);
    const b = project(outline[4].x, outline[4].y, bounds, SIZE);
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    const len = Math.hypot(dx, dy) || 1;
    // unit normal to the direction of travel
    const nx = -dy / len;
    const ny = dx / len;
    const half = 13;
    return { x1: a.cx - nx * half, y1: a.cy - ny * half, x2: a.cx + nx * half, y2: a.cy + ny * half };
  }, [bounds, outline]);

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
    // Some circuits' corner data (from MultiViewer) has more than one point sharing the
    // same corner number — not a second real corner, just extra/incorrect entries. Show
    // each number once, keeping its first (correct) point.
    const seen = new Set<number>();
    const uniqueCorners = circuit.corners.filter((c) => {
      if (seen.has(c.number)) return false;
      seen.add(c.number);
      return true;
    });
    return uniqueCorners.map((c) => {
      const rx = c.x * cos - c.y * sin;
      const ry = c.x * sin + c.y * cos;
      const cx = offX + (rx - bounds.minX) * scale;
      const cy = SIZE - (offY + (ry - bounds.minY) * scale);
      const a = ((c.angle ?? 0) * Math.PI) / 180;
      const dx = Math.cos(a) * cos - Math.sin(a) * sin;
      const dy = Math.cos(a) * sin + Math.sin(a) * cos;
      // Prefer the organiser's label so a lettered turn (5A) shows as written, not as "5".
      return { n: c.label ?? String(c.number), x: cx + dx * OFF, y: cy - dy * OFF };
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
  const suspendedRef = useRef(false);
  useEffect(() => {
    suspendedRef.current = suspended === true;
  }, [suspended]);
  // Per-car smoothed screen position (EMA) — the raw GPS samples carry speed noise
  // (~28% of consecutive samples imply >60% speed jumps), so rendering them faithfully
  // makes dots surge/slow. Entries allocated once per car, then mutated in place.
  const smoothRef = useRef(new Map<number, { x: number; y: number; shown: boolean }>());

  // Positions are updated IMPERATIVELY (no React re-render per frame).
  const dotsGroupRef = useRef<SVGGElement>(null);
  const trailRef = useRef<SVGGElement>(null);
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
        setPlaybackT(pt); // share the interpolation clock (telemetry card renders the same instant)

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

        // Heat trail: where the selected car was over the last few seconds of playback. Head
        // starts at the dot's own smoothed position so the two never separate; each older point
        // is sampled from the buffer exactly as the dot was. A jump between samples (pit exit,
        // the car reappearing, a hole in the data) ends the trail there rather than drawing a
        // chord across the infield.
        const trail = trailRef.current;
        if (trail) {
          const segs = trail.children;
          let shown = 0;
          const head = sel != null ? smooth.get(sel) : undefined;
          const drawable =
            sel != null && head?.shown === true && !suspendedRef.current && !pits?.has(sel) && !outs?.has(sel) && !!a.c[sel];
          if (drawable) {
            let px = head!.x;
            let py = head!.y;
            for (let k = 0; k < segs.length; k++) {
              if (!sampleCar(buf, sel!, pt - (k + 1) * TRAIL_STEP_MS)) break;
              const rx = sampled[0] * cos - sampled[1] * sin;
              const ry = sampled[0] * sin + sampled[1] * cos;
              const qx = offX + (rx - minX) * scale;
              const qy = SIZE - (offY + (ry - minY) * scale);
              const dx = qx - px;
              const dy = qy - py;
              if (dx * dx + dy * dy >= TRAIL_JUMP_SQ) break;
              const seg = segs[k] as SVGLineElement;
              seg.setAttribute("x1", px.toFixed(1));
              seg.setAttribute("y1", py.toFixed(1));
              seg.setAttribute("x2", qx.toFixed(1));
              seg.setAttribute("y2", qy.toFixed(1));
              seg.style.visibility = "visible";
              px = qx;
              py = qy;
              shown++;
            }
          }
          for (let k = shown; k < segs.length; k++) (segs[k] as SVGLineElement).style.visibility = "hidden";
          trail.style.visibility = shown > 0 ? "visible" : "hidden";
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

  // Wait for the circuit outline, driver identities, AND enough position samples to
  // actually place a dot — three separate things that resolve at different times (the
  // circuit outline is its own fetch; driver identities arrive on the first live poll, but
  // the animation loop needs 2+ position frames to interpolate, which usually only exists
  // after the SECOND poll ~3s later). Revealing the track before all three are ready showed
  // an empty (or driver-less) track for a couple seconds before any dot appeared.
  if (!bounds || drivers.size === 0 || !hasFrames) {
    return (
      // Same shrink-0 + aspect-square box as the loaded map below. It previously used
      // h-full/min-h-80, so the card rendered ~320px tall and then jumped to the full square
      // the instant the first frames arrived — a visible shift on every page load.
      <div className="flex shrink-0 flex-col">
        <span className="eyebrow mb-2 block text-[0.6rem] text-muted">
          Driver <span className="text-red">Tracker</span>
        </span>
        {failed ? (
          <div className="flex aspect-square w-full items-center justify-center rounded-lg carbon-bg px-6 text-center text-sm text-white/40">
            {/* With positions coming in we ARE building it, so say that rather than
                "unavailable" — it resolves itself within a lap. Without them (no token, or
                a stopped session) nothing is being traced and the old wording still holds. */}
            {hasFrames ? "Mapping this circuit \u2014 ready after a lap." : "No track map for this circuit."}
          </div>
        ) : (
          <div className="relative aspect-square w-full overflow-hidden rounded-lg carbon-bg ring-1 ring-white/10">
            <div className="skeleton-dark absolute inset-6 rounded-full opacity-60" />
            <span className="absolute inset-0 flex items-center justify-center text-sm text-white/40">
              {!bounds ? "Loading circuit…" : "Loading drivers…"}
            </span>
          </div>
        )}
      </div>
    );
  }

  // Track-status tint: yellow / SC-orange / red glow around the map while not clear.
  //
  // A SUSPENDED race outranks everything. TrackStatus cannot be trusted for it: through the
  // 2026 Dutch GP red flag it read "5" briefly and then "2" (yellow) for the rest of the
  // stoppage, and on the live feed it read "1" (green) the whole time, because marshals had
  // cleared the track while the race was still stopped. A red-flagged race glowing yellow is
  // the one state that must never be understated, so it is driven by SessionStatus instead.
  //
  // Formation lap is next, tinted yellow like a Yellow Flag — the race has not gone green yet,
  // and trackStatus is usually still "clear" at that point.
  const ts = trackStatusInfo(trackStatus ?? undefined);
  // "Race Suspended" is the right words only for a race. A red flag in practice or qualifying
  // stops the session without suspending a classification, and calling FP1 a suspended race
  // reads as a bug — so name the flag itself outside the race.
  const tint = suspended
    ? { color: "#e10600", label: mode === "race" ? "Race Suspended" : "Red Flag", dark: false }
    : formationLap
      ? { color: "#f5c518", label: "Formation Lap", dark: true }
      : trackStatus && !ts.calm
        ? { color: ts.color, label: ts.label, dark: trackStatus === "2" || trackStatus === "7" }
        : null;

  return (
    // Fixed square, and shrink-0 so nothing below can squeeze it: the circuit is the
    // centrepiece and a squashed map reads badly. The tyre card below absorbs the height
    // change instead when a driver is selected.
    <div className="flex shrink-0 flex-col">
      <span className="eyebrow mb-2 block text-[0.6rem] text-muted">
        Driver <span className="text-red">Tracker</span>
      </span>
      <div
        className="relative aspect-square w-full overflow-hidden rounded-lg carbon-bg ring-1 ring-white/10"
        style={{
          boxShadow: tint ? `inset 0 0 0 3px ${tint.color}, inset 0 0 60px ${tint.color}33` : "none",
          transition: "box-shadow 0.6s ease",
        }}
      >
        {tint && (
          <span
            className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.6rem] font-bold tracking-wider"
            style={{ backgroundColor: tint.color, color: tint.dark ? "#15151a" : "#fff" }}
          >
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-current" />
            {tint.label.toUpperCase()}
          </span>
        )}
        {name && (
          <span className="eyebrow absolute bottom-3 left-4 z-10 text-[0.7rem] font-semibold text-white/50">
            {name}
          </span>
        )}
        {laps && laps.total > 0 && !formationLap && (
          <span
            className="tnum absolute right-3 top-3 z-10 rounded-full bg-black/60 px-2.5 py-1 font-mono text-[0.65rem] font-bold tracking-wider text-white/85"
            title="Progress through the race — lap X of Y"
          >
            LAP {laps.current}/{laps.total}
          </span>
        )}
        {clock && (
          <span
            className="tnum absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-md bg-black/60 px-2.5 py-1 font-mono text-[0.65rem] font-bold tracking-wider text-white/85 ring-1 ring-white/15"
            aria-label="Session clock"
            title="Time remaining in this session"
          >
            <span className="text-white/50">{clock.label}</span>
            <span className="text-white">{clock.value}</span>
          </span>
        )}
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full">
          {path && (
            <path d={path} fill="none" stroke="#f4f4f6" strokeWidth={12} strokeLinejoin="round" strokeLinecap="round" />
          )}
          {startFinish && (
            <g aria-label="Start/finish line">
              {/* A black base with a dashed white stroke over it reads as a chequered strip at
                  map scale without needing a pattern fill. */}
              <line x1={startFinish.x1} y1={startFinish.y1} x2={startFinish.x2} y2={startFinish.y2} stroke="#15151a" strokeWidth={7} strokeLinecap="butt" />
              <line x1={startFinish.x1} y1={startFinish.y1} x2={startFinish.x2} y2={startFinish.y2} stroke="#ffffff" strokeWidth={7} strokeDasharray="3.5 3.5" strokeLinecap="butt" />
            </g>
          )}
          {cornerLabels.map((c, i) => (
            // Corner number isn't a safe key on its own — at least one circuit's outline
            // data has two entries sharing the same number (e.g. a split/sub corner).
            // Kept deliberately quiet: the track and the cars are the subject, the numbers are
            // reference. Same size and placement as before; only weight and contrast drop.
            <g key={`${c.n}-${i}`} transform={`translate(${c.x} ${c.y})`}>
              <circle r={12} fill="#15151a" fillOpacity={0.5} />
              <text
                textAnchor="middle"
                dominantBaseline="central"
                y={0.5}
                fontSize={20}
                fontWeight={600}
                fill="#c9c9d1"
                fillOpacity={0.6}
                fontFamily="var(--font-geist-mono), monospace"
              >
                {c.n}
              </text>
            </g>
          ))}
          <g ref={trailRef} aria-label="Selected car trail" style={{ visibility: "hidden" }} pointerEvents="none">
            {trailStyle.map((t, k) => (
              <line
                key={k}
                stroke={t.stroke}
                strokeWidth={t.width}
                strokeOpacity={t.opacity}
                strokeLinecap="round"
                style={{ visibility: "hidden" }}
              />
            ))}
          </g>
          <g ref={dotsGroupRef}>{dots}</g>
        </svg>
      </div>
    </div>
  );
}
