import fs from "fs";
import path from "path";

/**
 * Which build is serving this request. Open tabs compare it against the one they loaded with and
 * reload when it changes — otherwise a visitor watching a session keeps running the old page code
 * until they refresh by hand, however many fixes have shipped since.
 *
 * On Vercel that is the deployment. Locally, in development, it is the newest edit to the app's
 * source: hot reload normally picks edits up, but a tab it misses kept showing a pre-fix page all
 * through the Sepang 2026 suspended start until it was refreshed by hand.
 */
export const dynamic = "force-dynamic";

function newestEdit(dir: string): number {
  let newest = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    newest = Math.max(newest, e.isDirectory() ? newestEdit(p) : fs.statSync(p).mtimeMs);
  }
  return newest;
}

export function GET() {
  let version: string | null = process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null;
  if (!version && process.env.NODE_ENV === "development") {
    const root = process.cwd();
    version = String(Math.max(...["app", "lib", "data"].map((d) => (fs.existsSync(path.join(root, d)) ? newestEdit(path.join(root, d)) : 0))));
  }
  return Response.json({ version }, { headers: { "Cache-Control": "no-store" } });
}
