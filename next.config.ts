import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Pin the workspace root — a stray lockfile in a parent dir otherwise confuses inference.
  turbopack: { root: projectRoot },
  // Don't bundle the SignalR client / ws — they use dynamic requires that break bundling.
  serverExternalPackages: ["@microsoft/signalr", "ws"],
};

export default nextConfig;
