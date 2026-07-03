/** Shared 2D projection for the track map: OpenF1 world coords → SVG viewBox. */

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
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
