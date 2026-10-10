/**
 * Session start times from the FIA's own event timetable — the PDF the stewards re-issue
 * ("Timetable V2", "V3"…) whenever a session moves. It is the document the press quotes when
 * they report a delay, and it lands well before F1's feed catches up: Singapore 2026's
 * qualifying was put back to 21:30 in Timetable V3 at 18:49 local, while F1's index and live
 * feed still said 21:00 when the session was 30 minutes away.
 *
 * Backup only — F1's index and Race Control come first (see getLiveStatusData).
 */
import "server-only";
import { getDocumentProxy } from "unpdf";

const FIA = "https://www.fia.com";
const CHAMPIONSHIP = `${FIA}/documents/championships/fia-formula-one-world-championship-14`;
const UA = { "User-Agent": "Mozilla/5.0 (compatible; PitWall/1.0)" };

/** Row descriptions on the timetable → the session names F1's index and Jolpica use. */
const SESSIONS: [RegExp, string][] = [
  [/^FIRST PRACTICE/, "Practice 1"],
  [/^SECOND PRACTICE/, "Practice 2"],
  [/^THIRD PRACTICE/, "Practice 3"],
  [/^SPRINT QUALIFYING/, "Sprint Qualifying"],
  [/^SPRINT\b/, "Sprint"],
  [/^QUALIFYING/, "Qualifying"],
  [/^GRAND PRIX/, "Race"],
];

const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

async function text(url: string): Promise<string | null> {
  const res = await fetch(url, { headers: UA, cache: "no-store", signal: AbortSignal.timeout(8000) });
  return res.ok ? res.text() : null;
}

/** The current event's newest timetable PDF. The season page lists the latest event's documents. */
async function latestTimetableUrl(): Promise<string | null> {
  const year = new Date().getUTCFullYear();
  const champ = await text(CHAMPIONSHIP);
  const season = champ?.match(new RegExp(`/season/season-${year}-\\d+`))?.[0];
  if (!season) return null;
  const page = await text(`${CHAMPIONSHIP}${season}`);
  if (!page) return null;
  let best: { href: string; version: number } | null = null;
  for (const [, href] of page.matchAll(/href="([^"]*timetable[^"]*\.pdf)"/gi)) {
    const version = Number(/_v(\d+)\.pdf$/i.exec(href)?.[1] ?? 1);
    if (!best || version > best.version) best = { href, version };
  }
  return best ? new URL(best.href, FIA).toString() : null;
}

/**
 * Each F1 session's start as the circuit's local wall time ("2026-10-10T21:30"), from the PDF's
 * rows. Only rows for FORMULA 1 on TRACK count, so a support series' "QUALIFYING SESSION" in the
 * same table is never read as F1's.
 */
export function parseTimetableRows(rows: string[][]): Record<string, string> {
  const out: Record<string, string> = {};
  let day: string | null = null;
  for (const cells of rows) {
    const line = cells.join(" ");
    const d = /^(?:MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY) (\d{1,2}) ([A-Z]+) (\d{4})$/.exec(line.trim());
    if (d) {
      const m = MONTHS.indexOf(d[2]);
      day = m < 0 ? null : `${d[3]}-${String(m + 1).padStart(2, "0")}-${d[1].padStart(2, "0")}`;
      continue;
    }
    // Footnote markers ("1", "2", "*") are cells of their own; drop them before matching.
    const c = cells.map((s) => s.trim()).filter((s) => s && !/^[*\d]$/.test(s));
    const start = /^(\d{2}):(\d{2})$/.exec(c[0] ?? "");
    const at = c.indexOf("FORMULA 1");
    if (!day || !start || at < 0 || c[at + 1] !== "TRACK") continue;
    const desc = c.slice(at + 2).join(" ");
    const name = SESSIONS.find(([re]) => re.test(desc))?.[1];
    if (name && !(name in out)) out[name] = `${day}T${start[1]}:${start[2]}`;
  }
  return out;
}

async function readRows(pdfBytes: ArrayBuffer): Promise<string[][]> {
  const pdf = await getDocumentProxy(new Uint8Array(pdfBytes));
  const rows: string[][] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const { items } = await (await pdf.getPage(p)).getTextContent();
    const byY = new Map<number, { x: number; s: string }[]>();
    for (const it of items) {
      if (!("str" in it) || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      const key = [...byY.keys()].find((k) => Math.abs(k - y) <= 3) ?? y;
      if (!byY.has(key)) byY.set(key, []);
      byY.get(key)!.push({ x: it.transform[4], s: it.str });
    }
    for (const y of [...byY.keys()].sort((a, b) => b - a)) {
      rows.push(byY.get(y)!.sort((a, b) => a.x - b.x).map((i) => i.s));
    }
  }
  return rows;
}

/** Local wall-clock starts by session name from the current event's newest FIA timetable. */
export async function fiaTimetableStarts(): Promise<Record<string, string>> {
  const url = await latestTimetableUrl();
  if (!url) return {};
  const res = await fetch(url, { headers: UA, cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!res.ok) return {};
  return parseTimetableRows(await readRows(await res.arrayBuffer()));
}
