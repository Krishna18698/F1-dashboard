import type { Metadata } from "next";
import { Geist, Geist_Mono, JetBrains_Mono, Playfair_Display } from "next/font/google";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Timing numbers (lap times, sectors, gaps, countdowns). JetBrains Mono has squarer,
// more legible figures than Geist Mono at small sizes, which suits a timing screen.
const timing = JetBrains_Mono({
  variable: "--font-timing",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const display = Playfair_Display({
  variable: "--font-display",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["600", "700", "800", "900"],
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
        <Analytics />
      </body>
    </html>
  );
}
