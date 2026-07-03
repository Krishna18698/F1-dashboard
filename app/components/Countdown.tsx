"use client";

import { useEffect, useState } from "react";

function diff(targetMs: number) {
  const total = Math.max(0, targetMs - Date.now());
  const days = Math.floor(total / 86_400_000);
  const hours = Math.floor((total % 86_400_000) / 3_600_000);
  const mins = Math.floor((total % 3_600_000) / 60_000);
  const secs = Math.floor((total % 60_000) / 1000);
  return { days, hours, mins, secs, done: total === 0 };
}

const pad = (n: number) => String(n).padStart(2, "0");

export default function Countdown({ targetISO }: { targetISO: string }) {
  const targetMs = Date.parse(targetISO);
  const [t, setT] = useState(() => diff(targetMs));

  useEffect(() => {
    const id = setInterval(() => setT(diff(targetMs)), 1000);
    return () => clearInterval(id);
  }, [targetMs]);

  const cells: [string, number][] = [
    ["Days", t.days],
    ["Hrs", t.hours],
    ["Min", t.mins],
    ["Sec", t.secs],
  ];

  return (
    <div className="flex gap-2 sm:gap-3">
      {cells.map(([label, val]) => (
        <div
          key={label}
          className="flex min-w-[3.4rem] flex-col items-center rounded-md bg-paper/10 px-3 py-2 backdrop-blur-sm ring-1 ring-white/15 sm:min-w-[4rem]"
        >
          <span className="tnum font-mono text-2xl font-bold leading-none text-white sm:text-3xl">
            {pad(val)}
          </span>
          <span className="eyebrow mt-1 text-[0.6rem] text-white/55">{label}</span>
        </div>
      ))}
    </div>
  );
}
