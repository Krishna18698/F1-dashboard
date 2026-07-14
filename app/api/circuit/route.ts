import { NextRequest } from "next/server";

export const revalidate = 86400; // circuit layouts don't change — cache a day

// MultiViewer publishes circuit outlines (in F1's coordinate system) per year.
// Layouts are stable, so try recent known-good years for the given circuit key.
const YEARS = [2024, 2023, 2025, 2026, 2022];

interface MvCorner {
  number: number;
  angle?: number; // direction (deg, track coords) pointing OUTWARD — where the label goes
  trackPosition?: { x: number; y: number };
}

/** Returns a circuit outline + corners aligned to the live position feed's coordinates. */
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!key || !/^\d+$/.test(key)) {
    return Response.json({ error: "invalid key" }, { status: 400 });
  }

  for (const year of YEARS) {
    try {
      const res = await fetch(`https://api.multiviewer.app/api/v1/circuits/${key}/${year}`, {
        headers: { "User-Agent": "Mozilla/5.0" },
        next: { revalidate: 86400 },
      });
      if (!res.ok) continue;
      const d = (await res.json()) as {
        x?: number[];
        y?: number[];
        rotation?: number;
        corners?: MvCorner[];
      };
      if (!d.x?.length || !d.y?.length) continue;

      return Response.json({
        x: d.x,
        y: d.y,
        rotation: d.rotation ?? 0,
        corners: (d.corners ?? [])
          .filter((c) => c.trackPosition)
          .map((c) => ({ number: c.number, x: c.trackPosition!.x, y: c.trackPosition!.y, angle: c.angle ?? 0 })),
      });
    } catch {
      // try next year
    }
  }
  return Response.json({ error: "not found" }, { status: 404 });
}
