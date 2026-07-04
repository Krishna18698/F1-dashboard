import { NextRequest, NextResponse } from "next/server";

/**
 * Optional password gate. When DASHBOARD_PASSWORD is set (e.g. on the deployed
 * host), every route requires HTTP Basic auth — so only you can reach it. Left
 * unset locally, the dashboard is open (no prompt).
 */
export function middleware(req: NextRequest) {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) return NextResponse.next();

  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    try {
      const [, pass] = atob(auth.slice(6)).split(":");
      if (pass === expected) return NextResponse.next();
    } catch {}
  }
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Pit Wall", charset="UTF-8"' },
  });
}

export const config = {
  // Guard everything except Next's static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
