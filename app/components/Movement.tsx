/** Championship movement vs the previous round: green ▲n / red ▼n / muted –. */
export default function Movement({ prevPos, pos }: { prevPos?: number; pos: number }) {
  if (!prevPos) return <span className="w-6 shrink-0" />;
  const d = prevPos - pos;
  if (d === 0) return <span className="w-6 shrink-0 text-center text-[0.6rem] text-muted">–</span>;
  const up = d > 0;
  return (
    <span
      className="tnum flex w-6 shrink-0 items-center justify-center gap-0.5 font-mono text-[0.6rem] font-bold leading-none"
      style={{ color: up ? "#37b24d" : "#e10600" }}
      title={`${up ? "Up" : "Down"} ${Math.abs(d)} vs last round`}
    >
      {up ? "▲" : "▼"}
      {Math.abs(d)}
    </span>
  );
}
