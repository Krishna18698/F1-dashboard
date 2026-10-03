import { NextRequest } from "next/server";
import madrid from "@/data/circuits/153.json";
import sepang from "@/data/circuits/12.json";

/**
 * Outlines we hold ourselves, for circuits nobody else publishes. Checked BEFORE MultiViewer.
 *
 * Madrid (153) is not in MultiViewer for any year — their keys stop at 152 — and their v2 API
 * is licensed for their own app only. This one was traced from F1's own position feed: one
 * clean lap of the 2026 race by car #12 (lap 33, 97.66 s), cut exactly at the timing line
 * from the NumberOfLaps ticks and closed to within 0.11% of the circuit's diagonal. Being in
 * the feed's own coordinate system it aligns with the car dots by construction.
 *
 * No corner numbers yet: those need the official sequence matched to specific bends, which
 * is a one-off manual job — see data/circuits/153.json.
 *
 * Sepang (12, "Kuala Lumpur" in F1's feed — the 2026 Bahrain GP relocation) has not been raced
 * since 2017, so MultiViewer has nothing either. Traced the same way from 2026 FP3: car #12's
 * fastest lap (1:36.302), cut at its lap tick and at tick − lap time with positions interpolated
 * to those instants, closing to 0.6 m. 5,495 m traced against 5,543 m official. The 15 official
 * turns are matched in order to the lap's turning points, each label on the outside of its bend.
 */
const BUNDLED: Record<string, { x: number[]; y: number[]; rotation: number; corners: MvCorner[] }> = {
  "153": madrid as { x: number[]; y: number[]; rotation: number; corners: MvCorner[] },
  "12": sepang as { x: number[]; y: number[]; rotation: number; corners: MvCorner[] },
};

export const revalidate = 86400; // circuit layouts don't change — cache a day

// MultiViewer publishes circuit outlines (in F1's coordinate system) per year.
// Layouts are stable, so try recent known-good years for the given circuit key.
const YEARS = [2024, 2023, 2025, 2026, 2022];

interface MvCorner {
  number: number;
  /** Organiser's text label where a bare number cannot express it (Madrid's 5A). */
  label?: string;
  angle?: number; // direction (deg, track coords) pointing OUTWARD — where the label goes
  trackPosition?: { x: number; y: number };
}

/** Returns a circuit outline + corners aligned to the live position feed's coordinates. */
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!key || !/^\d+$/.test(key)) {
    return Response.json({ error: "invalid key" }, { status: 400 });
  }

  const own = BUNDLED[key];
  if (own?.x?.length) {
    return Response.json({
      x: own.x,
      y: own.y,
      rotation: own.rotation ?? 0,
      corners: (own.corners ?? []).map((c) => ({ number: c.number, label: c.label, x: c.trackPosition?.x ?? 0, y: c.trackPosition?.y ?? 0, angle: c.angle ?? 0 })),
    });
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
