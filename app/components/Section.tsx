import { ReactNode } from "react";

export default function Section({
  title,
  emphasis,
  hint,
  children,
}: {
  title: string;
  emphasis?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-4 flex items-baseline justify-between gap-2 border-b-2 border-ink pb-2">
        <h3 className="font-display whitespace-nowrap text-xl xl:text-2xl">
          {title} {emphasis && <span className="italic text-red">{emphasis}</span>}
        </h3>
        {hint && (
          <span className="eyebrow hidden shrink-0 text-[0.55rem] text-muted xl:inline">
            {hint}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}
