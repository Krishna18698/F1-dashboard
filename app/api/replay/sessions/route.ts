import { NextRequest } from "next/server";
import { replayArchiveSessions } from "@/lib/replay/replayArchive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// OpenF1, the source without an F1 TV login, covers 2023 onward.
const FIRST_YEAR = 2023;

/**
 * The replay's session picker: every completed session of a season, newest first, and the
 * seasons there are to choose from. Paths returned here are the only ones /api/f1live will
 * replay.
 */
export async function GET(req: NextRequest) {
  const thisYear = new Date().getUTCFullYear();
  const asked = Number(req.nextUrl.searchParams.get("year")) || thisYear;
  const year = Math.min(thisYear, Math.max(FIRST_YEAR, asked));
  const years = Array.from({ length: thisYear - FIRST_YEAR + 1 }, (_, i) => thisYear - i);
  try {
    const sessions = await replayArchiveSessions(year);
    return Response.json({ year, years, sessions });
  } catch {
    return Response.json({ year, years, sessions: [] });
  }
}
