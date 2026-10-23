/**
 * Where a corner number goes on the map: just outside the track at its own corner, and never on
 * top of another stretch of track or another number.
 *
 * MultiViewer gives each corner an outward angle, and the number used to sit a fixed distance
 * along it. Where the circuit folds back on itself that spot can be ON the track — COTA's 14 sat
 * on the 15→16 section (Austin FP1 2026). So the preferred spot is tried first, then the nearest
 * alternatives (further out, swung either side, the other side of the corner) until one is clear.
 */

export interface Pt {
  x: number;
  y: number;
}

/** Track stroke half-width (6) + number badge radius (12) + a little air. */
const TRACK_CLEARANCE = 22;
/** Two badges (radius 12) side by side, with a gap. */
const LABEL_CLEARANCE = 26;
/** Out from the corner. 42 first: driver tags float a fixed ~27px above each dot, and nearer
 *  than that the number lands under a tag on the common corner. */
const DISTANCES = [42, 50, 58, 66];
const SWINGS = [0, 20, -20, 40, -40, 60, -60, 90, -90, 180, 150, -150, 120, -120];

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance from `p` to the closed track polyline. */
export function trackDistance(p: Pt, track: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < track.length; i++) {
    const d = distToSegment(p, track[i], track[(i + 1) % track.length]);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Place every corner's number. `corners` are screen points with a unit outward direction
 * (screen space); `track` is the projected outline. Corners are placed in order, each also
 * keeping clear of the numbers already placed.
 */
export function placeCornerLabels(corners: (Pt & { dx: number; dy: number })[], track: Pt[], size: number): Pt[] {
  // Cheapest change first: a small swing before a big one, nearer before further out.
  const candidates: { swing: number; dist: number; cost: number }[] = [];
  for (const swing of SWINGS) {
    for (const dist of DISTANCES) candidates.push({ swing, dist, cost: Math.abs(swing) / 20 + (dist - DISTANCES[0]) / 8 });
  }
  candidates.sort((a, b) => a.cost - b.cost);

  const placed: Pt[] = [];
  for (const c of corners) {
    let chosen: Pt | null = null;
    let fallback: { p: Pt; clear: number } | null = null;
    for (const { swing, dist } of candidates) {
      const r = (swing * Math.PI) / 180;
      const dx = c.dx * Math.cos(r) - c.dy * Math.sin(r);
      const dy = c.dx * Math.sin(r) + c.dy * Math.cos(r);
      const p = { x: c.x + dx * dist, y: c.y + dy * dist };
      const clear = trackDistance(p, track);
      const nearLabel = placed.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < LABEL_CLEARANCE);
      // The badge's own radius may touch the edge (numbers there always have) but not cross it.
      const inside = p.x >= 10 && p.y >= 10 && p.x <= size - 10 && p.y <= size - 10;
      if (clear >= TRACK_CLEARANCE && !nearLabel && inside) {
        chosen = p;
        break;
      }
      if (!fallback || clear > fallback.clear) fallback = { p, clear };
    }
    const p = chosen ?? fallback!.p;
    placed.push(p);
  }
  return placed;
}
