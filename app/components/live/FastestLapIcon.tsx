/**
 * The fastest-lap marker beside a driver's name, as F1 TV's timing tower shows it: a white
 * stopwatch on the same purple as the "Fastest Lap" badge.
 */
export default function FastestLapIcon() {
  return (
    <span
      title="Fastest lap"
      aria-label="Fastest lap"
      className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] bg-[#b800e0]"
    >
      <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
        <circle cx="8" cy="9.5" r="5" />
        <path d="M8 9.5V6.8M6.3 1.8h3.4M8 1.8v2.4" />
      </svg>
    </span>
  );
}
