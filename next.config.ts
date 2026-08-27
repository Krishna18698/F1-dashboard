import type { NextConfig } from "next";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * Every non-internal IPv4 address this machine has, so the dev server can be opened from a
 * phone on the same wifi.
 *
 * Next blocks cross-origin requests to /_next/* dev resources by default. Opening the dev
 * server at http://192.168.x.x:3000 therefore serves the HTML fine but blocks the dev client,
 * so React never hydrates: the countdown freezes, every session time stays "—" (its
 * mounted-gate never flips), and no button responds. Nothing looks broken enough to suggest
 * the cause, which is what makes it worth documenting here.
 *
 * Discovered rather than hardcoded — a DHCP lease change would silently reintroduce the
 * problem. DEV ONLY: Next ignores this in a production build, so it cannot widen anything on
 * a deployed site.
 */
const lanOrigins = Object.values(os.networkInterfaces())
  .flat()
  .filter((n): n is os.NetworkInterfaceInfo => !!n && n.family === "IPv4" && !n.internal)
  .map((n) => n.address);

const nextConfig: NextConfig = {
  // Pin the workspace root — a stray lockfile in a parent dir otherwise confuses inference.
  turbopack: { root: projectRoot },
  allowedDevOrigins: lanOrigins,
  // Don't bundle the SignalR client / ws — @microsoft/signalr does its own internal
  // `require("ws")` at runtime (its Node transport fallback, loaded regardless of which
  // transport we actually request), so it must stay a real, non-inlined package on disk.
  serverExternalPackages: ["@microsoft/signalr", "ws"],
  // serverExternalPackages alone wasn't enough — Vercel's file-tracer doesn't see signalr's
  // own internal requires (conditional/dynamic inside its compiled code), so it silently
  // dropped these packages' files from the deployed function one at a time as each was
  // discovered missing in prod ("Cannot find module 'ws'", then "eventsource", then
  // "tough-cookie", ...). This is @microsoft/signalr's FULL Node-side dependency closure
  // (its package.json deps: abort-controller, eventsource, fetch-cookie, node-fetch, ws —
  // plus every one of *their* transitive deps, traced by hand), force-included in one shot
  // instead of discovering the rest one deploy at a time.
  outputFileTracingIncludes: {
    "/api/**/*": [
      "./node_modules/ws/**/*",
      "./node_modules/eventsource/**/*",
      "./node_modules/abort-controller/**/*",
      "./node_modules/fetch-cookie/**/*",
      "./node_modules/node-fetch/**/*",
      "./node_modules/event-target-shim/**/*",
      "./node_modules/tough-cookie/**/*",
      "./node_modules/set-cookie-parser/**/*",
      "./node_modules/whatwg-url/**/*",
      "./node_modules/psl/**/*",
      "./node_modules/punycode/**/*",
      "./node_modules/universalify/**/*",
      "./node_modules/url-parse/**/*",
      "./node_modules/querystringify/**/*",
      "./node_modules/requires-port/**/*",
      "./node_modules/tr46/**/*",
      "./node_modules/webidl-conversions/**/*",
    ],
  },
};

export default nextConfig;
