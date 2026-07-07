import type { MetadataRoute } from "next";

/** PWA / "Add to Home Screen" manifest. Next serves this at /manifest.webmanifest
 *  and injects <link rel="manifest">. Icons are served from /public. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Krishna Shravan's Pit Wall · F1 Live Dashboard",
    short_name: "Pit Wall",
    description: "Live F1 timing, tyre strategy, standings and race calendar.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#e10600",
    icons: [
      { src: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
      { src: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
