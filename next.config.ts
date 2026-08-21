import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Pin the workspace root — a stray lockfile in a parent dir otherwise confuses inference.
  turbopack: { root: projectRoot },
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
