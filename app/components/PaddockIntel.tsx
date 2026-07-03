import { IntelItem } from "@/lib/news";

function Meta({ source, date }: { source: string; date: string }) {
  return (
    <span className="eyebrow text-[0.55rem] text-muted">
      {source}
      {date && <span className="text-red"> · {date}</span>}
    </span>
  );
}

export default function PaddockIntel({ items }: { items: IntelItem[] }) {
  if (!items.length) {
    return <p className="text-sm text-muted">No paddock news right now.</p>;
  }

  const [lead, ...rest] = items;

  return (
    <div className="flex flex-col gap-4">
      {/* Lead story */}
      <a
        href={lead.link}
        target="_blank"
        rel="noopener noreferrer"
        className="group block rounded-lg border border-line bg-panel/60 p-4 transition-colors hover:border-red"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="eyebrow text-[0.6rem] text-red">The Story</span>
          <Meta source={lead.source} date={lead.date} />
        </div>
        <h4 className="font-display mt-1 text-xl leading-snug group-hover:text-red">
          {lead.title}
        </h4>
        {lead.description && (
          <p className="mt-2 line-clamp-5 text-sm leading-relaxed text-ink-soft">
            {lead.description}
          </p>
        )}
      </a>

      {/* Wire feed — each with a short summary + date · source */}
      <ul className="divide-y divide-line">
        {rest.map((it) => (
          <li key={it.link}>
            <a
              href={it.link}
              target="_blank"
              rel="noopener noreferrer"
              className="group block py-3"
            >
              <div className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-snug group-hover:text-red">
                    {it.title}
                  </p>
                  {it.description && (
                    <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-ink-soft">
                      {it.description}
                    </p>
                  )}
                  <div className="mt-1">
                    <Meta source={it.source} date={it.date} />
                  </div>
                </div>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
