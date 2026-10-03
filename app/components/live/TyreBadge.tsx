/** F1 sidewall colours, shared by every tyre token on the page. */
export const TYRE_COLOUR: Record<string, string> = {
  SOFT: "#e10600",
  MEDIUM: "#f5c518",
  HARD: "#ffffff",
  INTERMEDIATE: "#3fa34d",
  WET: "#1e6bd6",
};
const NAME: Record<string, string> = { SOFT: "Soft", MEDIUM: "Medium", HARD: "Hard", INTERMEDIATE: "Intermediate", WET: "Wet" };

/**
 * A tyre token for the light timing board: a white disc ringed in the compound's colour, with the
 * compound's initial inside. Null for a compound it doesn't know.
 */
export default function TyreBadge({ compound, title }: { compound: string; title?: string }) {
  // On a white disc a white Hard ring would disappear against the page, so it gets grey here.
  const c = compound === "HARD" ? "#b8b8c0" : TYRE_COLOUR[compound];
  if (!c) return null;
  return (
    <span
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 bg-white"
      style={{ borderColor: c }}
      title={title ?? `${NAME[compound]} tyres`}
      aria-label={`${NAME[compound]} tyres`}
    >
      {/* Letter in the ring's colour, on a white disc. */}
      <span className="text-[0.55rem] font-bold leading-none" style={{ color: c }}>
        {compound[0]}
      </span>
    </span>
  );
}
