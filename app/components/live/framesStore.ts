// A plain (non-React) store for the ~3.3 Hz car-position stream.
//
// Why this exists: the live poll delivers a big frames payload every 3 s. If those
// frames flow through React state, every poll re-renders the whole live section and
// rebuilds Maps synchronously — a periodic long task that jitters the 60 fps map
// animation ("slight slow every few seconds", locked to the poll). By parking the
// frames in this module and letting the map's requestAnimationFrame loop read them
// directly, the moving dots are fully decoupled from React: no setState, no re-render.

export type Frame = { t: number; c: Record<string, [number, number]> };

const WINDOW_MS = 45_000; // keep ~45 s of history (DELAY + interpolation margin)

let buffer: Frame[] = [];
const subs = new Set<() => void>();

/** Merge a freshly-polled batch (deduped by timestamp), trim to the window. */
export function pushFrames(frames?: Frame[] | null): void {
  if (!frames?.length) return;
  const seen = new Set(buffer.map((f) => f.t));
  let changed = false;
  for (const f of frames) {
    if (!seen.has(f.t)) {
      buffer.push(f);
      seen.add(f.t);
      changed = true;
    }
  }
  if (!changed) return;
  buffer.sort((a, b) => a.t - b.t);
  const cutoff = buffer[buffer.length - 1].t - WINDOW_MS;
  if (buffer[0].t < cutoff) buffer = buffer.filter((f) => f.t >= cutoff);
  subs.forEach((fn) => fn());
}

/** Clear on unmount / session change so the next session starts fresh. */
export function resetFrames(): void {
  buffer = [];
  subs.forEach((fn) => fn());
}

/** Stable reference to the current buffer (mutated in place by pushFrames). */
export function getFrames(): Frame[] {
  return buffer;
}

export function subscribeFrames(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}
