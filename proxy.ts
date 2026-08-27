import { NextRequest, NextResponse } from "next/server";

/**
 * Optional password gate. When DASHBOARD_PASSWORD is set (e.g. on the deployed
 * host), every route requires HTTP Basic auth — so only you can reach it. Left
 * unset locally, the dashboard is open (no prompt).
 *
 * Named `proxy` in a file called proxy.ts: Next 16 deprecated the `middleware`
 * convention and renamed it, because "middleware" was routinely confused with
 * Express middleware. Same behaviour, and it still runs before any route renders.
 */
export function proxy(req: NextRequest) {
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
