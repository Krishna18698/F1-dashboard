import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Pin the workspace root — a stray lockfile in a parent dir otherwise confuses inference.
  turbopack: { root: projectRoot },
  // Don't bundle the SignalR client / ws / eventsource — @microsoft/signalr does its own
  // internal `require("ws")` and `require("eventsource")` at runtime (its Node transport
  // fallbacks, loaded regardless of which transport we actually request), so both must stay
  // real, non-inlined packages on disk for that to resolve, not get webpack-bundled away.
  serverExternalPackages: ["@microsoft/signalr", "ws", "eventsource"],
  // serverExternalPackages alone wasn't enough — Vercel's file-tracer doesn't see signalr's
  // own internal requires (they're conditional/dynamic inside signalr's own code), so it
  // silently dropped both packages' files from the deployed function ("Cannot find module
  // '.../ws/index.js'", then "Cannot find module 'eventsource'" in prod). Force-include both.
  outputFileTracingIncludes: {
    "/api/**/*": ["./node_modules/ws/**/*", "./node_modules/eventsource/**/*"],
  },
};

export default nextConfig;
