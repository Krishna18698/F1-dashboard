/** Brand colours keyed by Jolpica/Ergast constructorId. */
export const TEAM_COLOR: Record<string, string> = {
  mercedes: "#00d2be",
  ferrari: "#e10600",
  red_bull: "#3671c6",
  mclaren: "#ff8000",
  aston_martin: "#229971",
  alpine: "#0093cc",
  williams: "#64c4ff",
  rb: "#6692ff",
  sauber: "#52e252",
  haas: "#b6babd",
};

export function teamColor(constructorId?: string): string {
  return (constructorId && TEAM_COLOR[constructorId]) || "#8a8a92";
}
