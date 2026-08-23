/**
 * Championship points for a session F1 has already classified but Jolpica hasn't ingested.
 *
 * Jolpica is the official source but runs hours behind, and the live projection
 * (ChampionshipPrediction) is token-gated and only served while the relay still holds the
 * session. Between those two the standings would otherwise sit on pre-race totals — so this
 * derives the same numbers from the classification we already have.
 *
 * Provisional by nature: it reflects the chequered flag, not the stewards. Post-race penalties
 * and disqualifications land later, which is exactly why it is only ever used until Jolpica
 * publishes the round, at which point the official numbers take over.
 */
import { ConstructorStanding, DriverStanding } from "./jolpica";

/** 2026 points: top ten score a race, top eight a sprint. No fastest-lap point (dropped 2025). */
export const RACE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
export const SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1];

export interface Classified {
  pos: number;
  tla: string;
}

/** Points awarded to each driver code by one finished session. */
export function pointsFor(top: Classified[], sprint: boolean): Record<string, number> {
  const table = sprint ? SPRINT_POINTS : RACE_POINTS;
  const out: Record<string, number> = {};
  for (const r of top) {
    const p = table[r.pos - 1];
    if (p) out[r.tla] = p;
  }
  return out;
}

/**
 * Official standings plus one session's points, re-sorted. Returns the input untouched when
 * the session awarded nothing it can attribute, so a bad classification can never scramble
 * the table.
 */
export function applyToDrivers(standings: DriverStanding[], gained: Record<string, number>): DriverStanding[] {
  if (!Object.keys(gained).length) return standings;
  return standings
    .map((s) => ({ ...s, points: String(Number(s.points) + (gained[s.Driver.code ?? ""] ?? 0)) }))
    .sort((a, b) => Number(b.points) - Number(a.points))
    .map((s, i) => ({ ...s, position: String(i + 1) }));
}

export function applyToConstructors(
  standings: ConstructorStanding[],
  gained: Record<string, number>,
  teamOf: Record<string, string>,
): ConstructorStanding[] {
  if (!Object.keys(gained).length) return standings;
  const byTeam: Record<string, number> = {};
  for (const [tla, pts] of Object.entries(gained)) {
    const team = teamOf[tla];
    if (team) byTeam[team] = (byTeam[team] ?? 0) + pts;
  }
  return standings
    .map((s) => ({ ...s, points: String(Number(s.points) + (byTeam[s.Constructor.name] ?? 0)) }))
    .sort((a, b) => Number(b.points) - Number(a.points))
    .map((s, i) => ({ ...s, position: String(i + 1) }));
}
