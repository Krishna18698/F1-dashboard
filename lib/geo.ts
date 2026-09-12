/** Shared 2D projection for the track map: OpenF1 world coords → SVG viewBox. */

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Rotate points about the origin by `deg` degrees (F1 circuit data ships a rotation). */
export function rotate<T extends { x: number; y: number }>(pts: T[], deg: number): T[] {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return pts.map((p) => ({ ...p, x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }));
}

export function computeBounds(pts: { x: number; y: number }[], padRatio = 0.06): Bounds {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const padX = (maxX - minX) * padRatio || 100;
  const padY = (maxY - minY) * padRatio || 100;
  return { minX: minX - padX, maxX: maxX + padX, minY: minY - padY, maxY: maxY + padY };
}

/**
 * Map a world point into a square `size` viewBox, preserving aspect ratio and
 * centring. Y is flipped (world y-up → SVG y-down).
 */
export function project(x: number, y: number, b: Bounds, size: number) {
  const w = b.maxX - b.minX || 1;
  const h = b.maxY - b.minY || 1;
  const scale = Math.min(size / w, size / h);
  const offX = (size - w * scale) / 2;
  const offY = (size - h * scale) / 2;
  const cx = offX + (x - b.minX) * scale;
  const cy = size - (offY + (y - b.minY) * scale); // flip Y
  return { cx, cy };
}

/** Build an SVG path `d` string tracing the given points in the projection. */
export function tracePath(pts: { x: number; y: number }[], b: Bounds, size: number): string {
  if (pts.length === 0) return "";
  return pts
    .map((p, i) => {
      const { cx, cy } = project(p.x, p.y, b, size);
      return `${i === 0 ? "M" : "L"}${cx.toFixed(1)} ${cy.toFixed(1)}`;
    })
    .join(" ");
}

/**
 * Corner positions along a closed circuit outline, in order of travel from its first point.
 *
 * Used for circuits nobody publishes an outline for, where the track is traced from the cars
 * themselves and so arrives with no corner metadata at all. A corner is simply where the
 * track turns hard: resample to even spacing so a fast straight and a slow hairpin are
 * weighted the same, accumulate the heading change over a short window, and keep the local
 * peaks. Points must already START at the start/finish line — F1 numbers corners from there.
 */
export function detectCorners(
  pts: { x: number; y: number }[],
  opts: { minTurnDeg?: number; minGapRatio?: number; samples?: number } = {},
): { x: number; y: number }[] {
  const { minTurnDeg = 28, minGapRatio = 0.022, samples = 600 } = opts;
  if (pts.length < 20) return [];

  // Even spacing: raw samples bunch up where the car is slow, which is exactly at corners,
  // so unresampled curvature would find more "corners" the slower the section.
  const seg: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    seg.push(seg[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const total = seg[seg.length - 1];
  if (!(total > 0)) return [];
  const even: { x: number; y: number }[] = [];
  let j = 0;
  for (let k = 0; k < samples; k++) {
    const d = (k / samples) * total;
    while (j < seg.length - 2 && seg[j + 1] < d) j++;
    const span = seg[j + 1] - seg[j] || 1;
    const f = (d - seg[j]) / span;
    even.push({ x: pts[j].x + (pts[j + 1].x - pts[j].x) * f, y: pts[j].y + (pts[j + 1].y - pts[j].y) * f });
  }

  // Turn accumulated across a window either side of each point, in degrees.
  const w = Math.max(3, Math.round(samples * 0.012));
  const at = (i: number) => even[((i % samples) + samples) % samples];
  const turn: number[] = [];
  for (let i = 0; i < samples; i++) {
    const a = at(i - w);
    const b = at(i);
    const c = at(i + w);
    const h1 = Math.atan2(b.y - a.y, b.x - a.x);
    const h2 = Math.atan2(c.y - b.y, c.x - b.x);
    let d = ((h2 - h1) * 180) / Math.PI;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    turn.push(Math.abs(d));
  }

  // Local peaks above the threshold, thinned so one long corner is not counted several times.
  const minGap = Math.max(2, Math.round(samples * minGapRatio));
  const peaks: number[] = [];
  for (let i = 0; i < samples; i++) {
    const v = turn[i];
    if (v < minTurnDeg) continue;
    let best = true;
    for (let k = -minGap; k <= minGap && best; k++) {
      if (k === 0) continue;
      const o = turn[((i + k) % samples + samples) % samples];
      if (o > v || (o === v && k < 0)) best = false;
    }
    if (best) peaks.push(i);
  }
  return peaks.map((i) => even[i]);
}
