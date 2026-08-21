import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Pin the workspace root — a stray lockfile in a parent dir otherwise confuses inference.
  turbopack: { root: projectRoot },
  // Don't bundle the SignalR client — it uses dynamic requires that break bundling. `ws` is
  // deliberately NOT external: marking it external made Vercel's file-tracer skip copying its
  // actual files into the deployed function ("Cannot find module '.../ws/index.js'" in prod) —
  // letting webpack bundle it normally works instead.
  serverExternalPackages: ["@microsoft/signalr"],
};

export default nextConfig;
