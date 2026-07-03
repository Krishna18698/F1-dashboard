/**
 * Official race lap records, keyed by Jolpica/Ergast `circuitId`.
 * (Fastest race lap ever set at the circuit's current configuration.)
 * Unknown circuits fall back to null so the UI hides the field rather than lie.
 */
export interface LapRecord {
  time: string;
  driver: string;
  year: number;
}

const LAP_RECORDS: Record<string, LapRecord> = {
  albert_park: { time: "1:19.813", driver: "L. Norris", year: 2024 },
  bahrain: { time: "1:31.447", driver: "P. de la Rosa", year: 2005 },
  jeddah: { time: "1:30.734", driver: "L. Hamilton", year: 2021 },
  suzuka: { time: "1:30.983", driver: "L. Hamilton", year: 2019 },
  shanghai: { time: "1:32.238", driver: "M. Schumacher", year: 2004 },
  miami: { time: "1:29.708", driver: "M. Verstappen", year: 2023 },
  imola: { time: "1:15.484", driver: "L. Hamilton", year: 2020 },
  monaco: { time: "1:12.909", driver: "L. Hamilton", year: 2021 },
  villeneuve: { time: "1:13.078", driver: "V. Bottas", year: 2019 },
  catalunya: { time: "1:16.330", driver: "M. Verstappen", year: 2023 },
  red_bull_ring: { time: "1:05.619", driver: "C. Sainz", year: 2020 },
  silverstone: { time: "1:27.097", driver: "M. Verstappen", year: 2020 },
  hungaroring: { time: "1:16.627", driver: "L. Hamilton", year: 2020 },
  spa: { time: "1:46.286", driver: "V. Bottas", year: 2018 },
  zandvoort: { time: "1:11.097", driver: "L. Hamilton", year: 2021 },
  monza: { time: "1:21.046", driver: "R. Barrichello", year: 2004 },
  baku: { time: "1:43.009", driver: "C. Leclerc", year: 2019 },
  marina_bay: { time: "1:41.905", driver: "L. Hamilton", year: 2023 },
  americas: { time: "1:36.169", driver: "C. Leclerc", year: 2019 },
  rodriguez: { time: "1:17.774", driver: "V. Bottas", year: 2021 },
  interlagos: { time: "1:10.540", driver: "V. Bottas", year: 2018 },
  vegas: { time: "1:35.490", driver: "O. Piastri", year: 2023 },
  yas_marina: { time: "1:26.103", driver: "M. Verstappen", year: 2021 },
};

export function lapRecord(circuitId?: string): LapRecord | null {
  if (!circuitId) return null;
  return LAP_RECORDS[circuitId] ?? null;
}
