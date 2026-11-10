/**
 * Work started during a request that the response doesn't wait for: the next stretch of a replay
 * fetched ahead of need, telemetry for a followed driver, the weekend's tyre count.
 *
 * On Vercel an instance only runs while it's handling a request, so work left over once the
 * response has gone out crawled along in the few hundred milliseconds of each later poll: OpenF1
 * telemetry that downloads in 2 s took 35 s to arrive. A route hands `backgroundSettled` to
 * Next's `after()`, which keeps the instance running until this work is done.
 */
const pending = new Set<Promise<unknown>>();

/** Track `work` until it settles. Returns it unchanged. */
export function inBackground<T>(work: Promise<T>): Promise<T> {
  pending.add(work);
  work.then(
    () => pending.delete(work),
    () => pending.delete(work),
  );
  return work;
}

/** Resolves once nothing tracked is still running, including work that the work it waited for
 *  started (a chunk's telemetry follows its positions). */
export async function backgroundSettled(): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending]);
}
