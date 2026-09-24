/**
 * Runs the REAL app from a throwaway copy, so a scenario can switch on the TEST replay in
 * lib/live/liveConfig.ts without that edit ever existing in the working tree.
 */
import fs from "fs";
import path from "path";
import { spawn, execFileSync } from "child_process";
import { REPO, WORK, FIXTURES, PORT, TIMEZONE, HERE } from "../config.mjs";

const COPY = ["app", "lib", "data", "public", "proxy.ts", "next.config.ts", "package.json", "tsconfig.json", "postcss.config.mjs"];
export const APP = path.join(WORK, "app");

/** Fresh copy of the app's source. No .env files come across: no token, no Supabase, no password. */
export function prepareWorkspace(scenario) {
  fs.rmSync(path.join(APP), { recursive: true, force: true, filter: undefined });
  fs.mkdirSync(APP, { recursive: true });
  for (const f of COPY) {
    if (fs.existsSync(path.join(REPO, f))) execFileSync("cp", ["-R", path.join(REPO, f), APP]);
  }
  fs.symlinkSync(path.relative(APP, path.join(REPO, "node_modules")), path.join(APP, "node_modules"));

  // Turbopack must be rooted where node_modules really lives, and the dev "N" badge must not
  // end up in every screenshot.
  const cfg = path.join(APP, "next.config.ts");
  let src = fs.readFileSync(cfg, "utf8");
  src = src.replace("turbopack: { root: projectRoot }", `turbopack: { root: ${JSON.stringify(REPO)} },\n  devIndicators: false`);
  if (!src.includes("devIndicators: false")) throw new Error("next.config.ts changed shape — update lib/app.mjs");
  fs.writeFileSync(cfg, src);

  // The scenario's session, played through the live path.
  const live = path.join(APP, "lib/live/liveConfig.ts");
  let lc = fs.readFileSync(live, "utf8");
  if (scenario.replay) {
    const r = scenario.replay;
    const block = `replay: {
    enabled: true,
    sessionPath: ${JSON.stringify(r.sessionPath)},
    sessionType: ${JSON.stringify(r.sessionType)},
    circuitKey: ${r.circuitKey},
    location: ${JSON.stringify(r.location)},
    name: ${JSON.stringify(r.name)},
    anchorFrac: ${r.anchorFrac ?? 0},${r.anchorAtMs != null ? `\n    anchorAtMs: ${r.anchorAtMs},` : ""}
    restartedAtMs: ${Date.parse(scenario.now)},
    maskTokenGated: false,
  },`;
    const next = lc.replace(/replay: \{[\s\S]*?maskTokenGated: false,\n  \},/, block);
    if (next === lc) throw new Error("liveConfig.ts replay block changed shape — update lib/app.mjs");
    lc = next;
  }
  fs.writeFileSync(live, lc);

  // The TEST replay labels itself "Replay" in the UI. For these captures the archived session
  // stands in for the live one it was, so present it the way the live feed did on the day.
  if (scenario.replay) {
    const route = path.join(APP, "app/api/f1live/route.ts");
    const rs = fs.readFileSync(route, "utf8");
    let next = rs.replace("replay: true,\n        circuitKey: r.circuitKey,", "replay: false,\n        circuitKey: r.circuitKey,");
    // An exact moment instead of a fraction of the session, when the scenario gives one.
    next = next.replace(
      "const anchor = Math.floor(dur * r.anchorFrac);",
      "const anchor = (r as { anchorAtMs?: number }).anchorAtMs ?? Math.floor(dur * r.anchorFrac);",
    );
    if (next === rs || !next.includes("anchorAtMs")) throw new Error("f1live route TEST branch changed shape — update lib/app.mjs");
    fs.writeFileSync(route, next);
  }

  // The route-level skeleton, on a URL of its own so it can be captured without racing the
  // real page's render.
  fs.mkdirSync(path.join(APP, "app/shots/loading"), { recursive: true });
  fs.writeFileSync(path.join(APP, "app/shots/loading/page.tsx"), 'export { default } from "../../loading";\n');

  // Backdate the whole copy. Next's watcher counts a file written within its timestamp
  // tolerance of startup as changed, and a "changed" next.config.ts restarts the server partway
  // through the first captures.
  const past = new Date(Date.now() - 10 * 60_000);
  const touch = (p) => {
    fs.utimesSync(p, past, past);
    if (fs.statSync(p).isDirectory()) for (const f of fs.readdirSync(p)) if (f !== "node_modules" && f !== ".next") touch(path.join(p, f));
  };
  for (const f of fs.readdirSync(APP)) if (f !== "node_modules" && f !== ".next") touch(path.join(APP, f));
}

// Unsigned JWT whose only content is a far-future `exp` — enough for the app to treat an owner
// token as configured. Its connection attempts are refused by the preload like any other.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const DUMMY_TOKEN = `${b64({ alg: "none", typ: "JWT" })}.${b64({ exp: 4102444800 })}.screenshot-harness`;

let child = null;

/** Starts `next dev` in the copy with the fixed clock and recorded network. Resolves when it serves. */
export async function startServer(scenario, { record = false } = {}) {
  await stopServer();
  prepareWorkspace(scenario);
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(F1_TV_TOKEN|SUPABASE|DASHBOARD_PASSWORD|CRON_SECRET|OPENF1)/.test(k))),
    ...(scenario.ownerToken ? { F1_TV_TOKEN: DUMMY_TOKEN } : {}),
    TZ: TIMEZONE,
    SHOT_NOW: scenario.now,
    // "none" = an empty store: every upstream call fails, which is the site's degraded state.
    SHOT_FIXTURES: scenario.fixtures === "none" ? path.join(WORK, "no-fixtures") : FIXTURES,
    SHOT_MODE: record ? "record" : "replay",
    NODE_OPTIONS: `--require ${path.join(HERE, "lib/preload.cjs")}`,
    NEXT_TELEMETRY_DISABLED: "1",
  };
  const log = fs.openSync(path.join(WORK, "server.log"), "a");
  child = spawn(path.join(REPO, "node_modules/.bin/next"), ["dev", "-p", String(PORT)], { cwd: APP, env, stdio: ["ignore", log, log] });
  // Up = the page itself answers twice, a few seconds apart (a restart in between fails one).
  const deadline = Date.now() + 180_000;
  let ok = 0;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${PORT}/`);
      ok = res.ok ? ok + 1 : 0;
    } catch {
      ok = 0;
    }
    if (ok >= 2) return;
    await new Promise((r) => setTimeout(r, ok ? 3000 : 1000));
  }
  throw new Error(`dev server did not come up — see ${path.join(WORK, "server.log")}`);
}

export async function stopServer() {
  // The copy is rebuilt on every start; don't leave duplicate app sources lying in the repo for
  // the root lint/typecheck to trip over.
  const cleanup = () => fs.rmSync(APP, { recursive: true, force: true });
  if (!child) return cleanup();
  const c = child;
  child = null;
  c.kill("SIGTERM");
  await new Promise((r) => {
    const t = setTimeout(() => {
      c.kill("SIGKILL");
      r();
    }, 5000);
    c.once("exit", () => {
      clearTimeout(t);
      r();
    });
  });
  cleanup();
}

export const baseURL = `http://localhost:${PORT}`;
