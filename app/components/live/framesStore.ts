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
  const lastT = buffer.length ? buffer[buffer.length - 1].t : -Infinity;
  let changed = false;
  // Fast path: with incremental polling (`since`) every frame is strictly newer than the
  // buffer tail, so this is a plain append — no Set, no sort, no per-poll GC burst.
  if (frames[0].t > lastT) {
    for (const f of frames) buffer.push(f);
    changed = true;
  } else {
    const seen = new Set(buffer.map((f) => f.t));
    for (const f of frames) {
      if (!seen.has(f.t)) {
        buffer.push(f);
        seen.add(f.t);
        changed = true;
      }
    }
    if (changed) buffer.sort((a, b) => a.t - b.t);
  }
  if (!changed) return;
  const cutoff = buffer[buffer.length - 1].t - WINDOW_MS;
  if (buffer[0].t < cutoff) buffer = buffer.filter((f) => f.t >= cutoff);
  subs.forEach((fn) => fn());
}

/** Newest buffered timestamp — sent as `since` so the server returns only new frames. */
export function newestFrameT(): number {
  return buffer.length ? buffer[buffer.length - 1].t : 0;
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
