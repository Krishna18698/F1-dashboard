import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Pin the workspace root — a stray lockfile in a parent dir otherwise confuses inference.
  turbopack: { root: projectRoot },
  // Don't bundle the SignalR client / ws — @microsoft/signalr does its own internal
  // `require("ws")` at runtime (inside HttpConnection.js), so `ws` must stay a real,
  // non-inlined package on disk for that to resolve, not get webpack-bundled away.
  serverExternalPackages: ["@microsoft/signalr", "ws"],
  // serverExternalPackages alone wasn't enough — Vercel's file-tracer doesn't see signalr's
  // own internal `require("ws")` (it's conditional/dynamic inside signalr's own code), so it
  // silently dropped `ws`'s files from the deployed function ("Cannot find module
  // '.../ws/index.js'" in prod). Force-include it explicitly.
  outputFileTracingIncludes: {
    "/api/**/*": ["./node_modules/ws/**/*"],
  },
};

export default nextConfig;
