import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import VersionWatcher from "./components/VersionWatcher";

// Fonts are served from the repo (app/fonts, latin subset, variable WOFF2 — their OFL licences
// alongside), not fetched from Google at build time. That fetch made builds and dev compiles
// fail intermittently ("next/font/google queries have exactly one entry", Nov 2026), and it
// tied every build to Google being reachable. Same families, weights and CSS variables.
const geistSans = localFont({
  src: "./fonts/geist-latin.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
});

const geistMono = localFont({
  src: "./fonts/geist-mono-latin.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  adjustFontFallback: false,
});

// Timing numbers (lap times, sectors, gaps, countdowns). JetBrains Mono has squarer,
// more legible figures than Geist Mono at small sizes, which suits a timing screen.
const timing = localFont({
  src: "./fonts/jetbrains-mono-latin.woff2",
  variable: "--font-timing",
  weight: "400 700",
  adjustFontFallback: false,
});

const display = localFont({
  src: [
    { path: "./fonts/playfair-display-latin.woff2", weight: "600 900", style: "normal" },
    { path: "./fonts/playfair-display-latin-italic.woff2", weight: "600 900", style: "italic" },
  ],
  variable: "--font-display",
  adjustFontFallback: "Times New Roman",
});

export const metadata: Metadata = {
  title: "Pit Wall · F1 Live Dashboard",
  description:
    "Live Formula 1 dashboard — drivers' & constructors' championships, season calendar, countdown, and live driver tracking.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${timing.variable} ${display.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-paper text-ink">
        {children}
        <VersionWatcher />
        <Analytics />
      </body>
    </html>
  );
}
