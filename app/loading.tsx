/**
 * Route-level skeleton. The page is force-dynamic (it consults the live relay), so
 * without this users stare at a blank tab while the server fetches — this paints
 * instantly and mirrors the real layout so the swap causes no jumps.
 */
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-350 overflow-x-hidden px-4 py-6 sm:px-8 sm:py-8" aria-busy>
      {/* Masthead */}
      <header className="mb-6 flex items-center justify-between gap-3 border-b-4 border-ink pb-3">
        <h1 className="font-display text-2xl leading-none sm:text-4xl lg:text-5xl">
          <span className="text-ink">Krishna Shravan&apos;s </span>
          <span className="text-red">Pit Wall</span>
        </h1>
        <div className="skeleton h-7 w-24" />
      </header>

      <div className="flex flex-col gap-10">
        {/* Hero card */}
        <div className="carbon-bg rounded-xl p-6 ring-1 ring-white/10 sm:p-8">
          <div className="skeleton-dark h-5 w-40" />
          <div className="skeleton-dark mt-4 h-12 w-3/4 max-w-md" />
          <div className="skeleton-dark mt-4 h-4 w-56" />
          <div className="mt-6 flex justify-end gap-2 sm:gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton-dark h-14 w-12 sm:h-16 sm:w-16" />
            ))}
          </div>
        </div>

        {/* Weekend schedule */}
        <section>
          <div className="skeleton mb-4 h-7 w-52" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="skeleton h-20" />
            ))}
          </div>
        </section>

        {/* Season calendar */}
        <section>
          <div className="skeleton mb-4 h-7 w-48" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="skeleton h-28" />
            ))}
          </div>
        </section>

        {/* Live tracking bar */}
        <div className="skeleton h-12" />

        {/* Standings + intel columns */}
        <div className="grid gap-10 lg:grid-cols-3">
          {[0, 1, 2].map((col) => (
            <section key={col}>
              <div className="skeleton mb-4 h-7 w-56" />
              <div className="space-y-2.5">
                {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                  <div key={i} className="skeleton h-8" />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
