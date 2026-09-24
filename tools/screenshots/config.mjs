/**
 * What the harness renders. Everything that decides how a screenshot looks is here.
 */
import path from "path";
import { fileURLToPath } from "url";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "../..");
export const OUT = path.join(REPO, "project"); // gitignored deliverables
export const FIXTURES = path.join(HERE, "fixtures"); // recorded upstream responses (gitignored)
export const WORK = path.join(HERE, ".work"); // throwaway copy of the app (gitignored)
export const PORT = 3100;

// Every page is rendered in this zone and locale, so session times read the same on any machine.
export const TIMEZONE = "Asia/Kolkata";
export const LOCALE = "en-IN";

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 2 },
  // 390 wide like an iPhone 15; 700 tall is what's left of its 844pt screen once the frame
  // draws the status bar above and Safari's bottom bar below.
  mobile: { width: 390, height: 700, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};

const MADRID = "2026/2026-09-13_Spanish_Grand_Prix";
const hms = (h, m, sec) => ((h * 60 + m) * 60 + sec) * 1000;

/**
 * Each scenario is one server run: a fixed clock, and optionally a past session played through
 * the LIVE path (the app's own TEST replay, switched on in the throwaway copy only).
 */
export const SCENARIOS = {
  // Race week, between rounds: countdown to Baku, standings after Madrid.
  home: { now: "2026-09-23T14:30:00Z" },
  // Madrid race day, mid-race — the live dashboard as it looked with lights out.
  // ownerToken: the deployed site runs with the owner's F1 TV token, so visitors aren't asked for
  // one while a session is live. A dummy (never valid, never sent anywhere) stands in for it.
  race: {
    now: "2026-09-13T13:55:00Z",
    ownerToken: true,
    replay: {
      sessionPath: `${MADRID}/2026-09-13_Race/`,
      sessionType: "Race",
      circuitKey: 153,
      location: "Madrid",
      name: "Spanish Grand Prix · Race",
      anchorFrac: 0.62,
    },
  },
  // Madrid qualifying, Q3 with first runs in.
  quali: {
    now: "2026-09-12T14:45:00Z",
    ownerToken: true,
    replay: {
      sessionPath: `${MADRID}/2026-09-12_Qualifying/`,
      sessionType: "Qualifying",
      circuitKey: 153,
      location: "Madrid",
      name: "Spanish Grand Prix · Qualifying",
      anchorFrac: 0.86,
    },
  },
  // Same race, anchored on exact moments rather than a fraction of the session. `anchorAtMs` is
  // milliseconds into F1's archive streams (the timestamps printed in e.g. TrackStatus.jsonStream).
  // The page shows each moment ~20 s after the anchor (playback runs behind the feed).
  // VSC: deployed 01:21:27, ending 01:23:30 → Battles must say it is paused.
  "race-vsc": {
    now: "2026-09-13T14:20:00Z",
    ownerToken: true,
    replay: { sessionPath: `${MADRID}/2026-09-13_Race/`, sessionType: "Race", circuitKey: 153, location: "Madrid", name: "Spanish Grand Prix · Race", anchorAtMs: hms(1, 21, 50) },
  },
  // Lap 1 (lap 2 begins 00:59:55) → Battles waits for the order to settle.
  "race-start": {
    now: "2026-09-13T13:02:00Z",
    ownerToken: true,
    replay: { sessionPath: `${MADRID}/2026-09-13_Race/`, sessionType: "Race", circuitKey: 153, location: "Madrid", name: "Spanish Grand Prix · Race", anchorAtMs: hms(0, 58, 50) },
  },
  // FP3's red flag (Aborted 00:37:21 → 01:14:23). F1's own session clock kept running until
  // 00:58:35 and then held, so anchor inside the held stretch: red flag, clock frozen.
  "practice-redflag": {
    now: "2026-09-12T11:10:00Z",
    ownerToken: true,
    replay: { sessionPath: `${MADRID}/2026-09-12_Practice_3/`, sessionType: "Practice", circuitKey: 153, location: "Madrid", name: "Spanish Grand Prix · Practice 3", anchorAtMs: hms(1, 0, 30) },
  },
  // Every upstream unreachable — what a visitor sees if Jolpica, F1 and the news feeds are down.
  offline: { now: "2026-09-23T14:30:00Z", fixtures: "none" },
};
