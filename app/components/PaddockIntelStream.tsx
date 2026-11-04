import { getPaddockIntel } from "@/lib/news";
import PaddockIntel from "./PaddockIntel";

/**
 * The news, fetched on its own and streamed in when ready — the page no longer waits on RSS
 * providers before sending the race data (see the <Suspense> around this in app/page.tsx).
 */
export default async function PaddockIntelStream() {
  const items = await getPaddockIntel().catch(() => []);
  return <PaddockIntel items={items} />;
}

/** Holds the news section's shape while it loads: the lead story card, then the wire list. */
export function PaddockIntelSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading news">
      <div className="skeleton h-48 rounded-lg" />
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex flex-col gap-2 py-1">
          <div className="skeleton h-4 w-11/12 rounded" />
          <div className="skeleton h-3 w-3/4 rounded" />
        </div>
      ))}
    </div>
  );
}
