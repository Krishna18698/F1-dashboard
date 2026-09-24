/**
 * Captures every screen and state of the real app, desktop and mobile, into project/screens.
 *
 *   node capture.mjs             replay recorded fixtures (deterministic)
 *   node capture.mjs --record    refresh fixtures from the network first
 *   node capture.mjs --only race,home     just these scenarios
 */
import fs from "fs";
import path from "path";
import { chromium } from "@playwright/test";
import { SCENARIOS, OUT, VIEWPORTS, WORK, FIXTURES } from "./config.mjs";
import { startServer, stopServer, baseURL } from "./lib/app.mjs";
import { newContext, scrollToHeading, waitForTracking, minimizeRaceControl, showTelemetry, openRaceControl } from "./lib/browser.mjs";

const args = process.argv.slice(2);
const RECORD = args.includes("--record");
const only = args.find((a) => a.startsWith("--only"))?.split("=")[1]?.split(",") ?? (args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null);

const RAW = path.join(OUT, "screens", "raw");
const FULL = path.join(OUT, "screens", "full");

const settle = (page, ms = 1500) => page.waitForTimeout(ms);

async function openHome(page) {
  await page.goto(`${baseURL}/`, { waitUntil: "load", timeout: 180_000 });
  // Countdown, schedule times and the results ticker all wait for hydration + a first poll.
  await page.waitForFunction(() => !document.querySelector("[aria-busy]"), null, { timeout: 60_000 });
  await settle(page, 4000);
}

async function openTracking(page) {
  await openHome(page);
  await waitForTracking(page);
  await settle(page, 9000); // let every car finish its glide onto the outline
}

async function toReplay(page) {
  await openHome(page);
  await scrollToHeading(page, "Live Tracking");
  await page.getByRole("button", { name: "REPLAY", exact: true }).click();
  await waitForTracking(page);
  await settle(page, 9000);
}

async function selectDriver(page, row = 0) {
  await page.locator("ol > li.cursor-pointer").nth(row).click();
  await settle(page, 2500);
}

async function scrollToText(page, re, offset = 16) {
  const el = page.getByText(re).first();
  await el.waitFor();
  await el.evaluate((e, off) => window.scrollTo({ top: e.getBoundingClientRect().top + window.scrollY - off, behavior: "instant" }), offset);
  await settle(page, 400);
}

/** id → how to reach it. `full` also saves a full-page capture; `viewport:false` skips the screen-sized one. */
const STATES = {
  home: [
    { id: "home", go: openHome, full: true },
    { id: "weekend-schedule", go: async (p) => (await openHome(p), await scrollToHeading(p, "Weekend")) },
    { id: "calendar", go: async (p) => (await openHome(p), await scrollToHeading(p, "Season")) },
    { id: "standings", go: async (p) => (await openHome(p), await scrollToHeading(p, "Drivers'")) },
    { id: "constructors", only: "mobile", go: async (p) => (await openHome(p), await scrollToHeading(p, "Constructors'")) },
    { id: "news", go: async (p) => (await openHome(p), await scrollToHeading(p, "Paddock")) },
    { id: "live-idle", go: async (p) => (await openHome(p), await scrollToHeading(p, "Live Tracking")) },
    {
      id: "token-form-error",
      go: async (p) => {
        await openHome(p);
        await scrollToHeading(p, "Live Tracking");
        await p.getByRole("button", { name: "Add token" }).click();
        await p.getByPlaceholder("Paste your F1 TV token").fill("not-a-real-token");
        await p.getByRole("button", { name: "Save" }).click();
        await p.getByText("doesn't look like a valid token").waitFor();
        await settle(p, 500);
      },
    },
    { id: "replay", go: async (p) => (await toReplay(p), await scrollToHeading(p, "Live Tracking")) },
    {
      id: "replay-driver",
      go: async (p) => {
        await toReplay(p);
        await selectDriver(p, 0);
        await showTelemetry(p);
      },
    },
    { id: "replay-race-control", go: async (p) => (await toReplay(p), await scrollToHeading(p, "Live Tracking"), await openRaceControl(p)) },
    { id: "loading", go: async (p) => (await p.goto(`${baseURL}/shots/loading`, { waitUntil: "load" }), await settle(p, 800)) },
  ],
  race: [
    { id: "race-home", go: openTracking, full: true, cleanFull: true },
    { id: "race-live", go: async (p) => (await openTracking(p), await scrollToHeading(p, "Live Tracking")), elements: true },
    {
      id: "race-driver",
      go: async (p) => {
        await openTracking(p);
        await selectDriver(p, 2);
        await showTelemetry(p);
      },
    },
    {
      // Portfolio hero for the phone: leader selected, map and telemetry both on screen. Also
      // records where that car and the lap counter are, so compose.mjs can mark them.
      id: "race-focus",
      only: "mobile",
      go: async (p) => {
        await openTracking(p);
        await selectDriver(p, 0);
        const map = p.locator('svg:has([aria-label="Start/finish line"])').first();
        await map.evaluate((el) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 64, behavior: "instant" }));
        await settle(p, 1500);
        const focus = await p.evaluate(() => {
          const ring = document.querySelector('svg circle[r="22"]')?.getBoundingClientRect();
          const lap = (document.body.innerText.match(/LAP\s+(\d+\/\d+)/) || [])[1] ?? null;
          return { x: ring ? ring.x + ring.width / 2 : null, y: ring ? ring.y + ring.height / 2 : null, lap };
        });
        fs.mkdirSync(path.join(OUT, "screens", "elements"), { recursive: true });
        fs.writeFileSync(path.join(OUT, "screens", "elements", "race-focus.json"), JSON.stringify(focus));
      },
    },
    { id: "race-tyres", go: async (p) => (await openTracking(p), await minimizeRaceControl(p), await scrollToText(p, /^Tyre$/i, 24).catch(() => scrollToText(p, /Tyre/i))) },
    { id: "race-control-sheet", go: async (p) => (await openTracking(p), await scrollToHeading(p, "Live Tracking"), await openRaceControl(p)) },
    { id: "race-battles", go: async (p) => (await openTracking(p), await scrollToText(p, /On-track/i, 120)) },
    {
      id: "race-tracking-loading",
      go: async (p) => {
        // Hold the live feed so the section sits in its first-paint state.
        await p.route("**/api/f1live**", () => {});
        await p.goto(`${baseURL}/`, { waitUntil: "load" });
        await settle(p, 3000);
        await scrollToHeading(p, "Live Tracking");
      },
    },
  ],
  quali: [
    { id: "quali-live", go: async (p) => (await openTracking(p), await scrollToHeading(p, "Live Tracking")), full: true, cleanFull: true },
    { id: "quali-driver", go: async (p) => (await openTracking(p), await selectDriver(p, 0), await showTelemetry(p)) },
  ],
  "race-vsc": [{ id: "race-vsc-battles", go: async (p) => (await openTracking(p), await scrollToText(p, /On-track/i, 120)) }],
  "race-start": [{ id: "race-lap1-battles", only: "desktop", go: async (p) => (await openTracking(p), await scrollToText(p, /On-track/i, 120)) }],
  "practice-redflag": [{ id: "practice-redflag", go: async (p) => (await openTracking(p), await scrollToHeading(p, "Live Tracking")) }],
  offline: [{ id: "offline", go: openHome, full: true }],
};

/** Tight crops of the live section's parts, for the covers and the featured card. */
async function captureElements(page, id) {
  const dir = path.join(OUT, "screens", "elements");
  fs.mkdirSync(dir, { recursive: true });
  await minimizeRaceControl(page);
  // The collapsed Race Control pill floats over whatever sits bottom-right; it isn't part of
  // the map or the board, so keep it out of their crops.
  await page.addStyleTag({ content: '[aria-label="Show Race Control"]{visibility:hidden!important}' });
  await settle(page, 500);
  const map = page.locator('svg:has([aria-label="Start/finish line"])').first().locator("xpath=..");
  await map.screenshot({ path: path.join(dir, `${id}-map.png`) });
  const section = page.locator("h3").filter({ hasText: "Live Tracking" }).first().locator("xpath=../..");
  await section.screenshot({ path: path.join(dir, `${id}-section.png`) });
  const board = page.locator("ol:has(> li.cursor-pointer)").first().locator("xpath=..");
  await board.screenshot({ path: path.join(dir, `${id}-board.png`) });
  const hero = page.locator("main section").first();
  await hero.screenshot({ path: path.join(dir, `${id}-hero.png`) });
}

async function main() {
  fs.mkdirSync(WORK, { recursive: true });
  if (RECORD) fs.mkdirSync(FIXTURES, { recursive: true });
  fs.rmSync(path.join(FIXTURES, "misses.log"), { force: true });
  const browser = await chromium.launch({ args: ["--hide-scrollbars"] });
  const failures = [];
  try {
    for (const [name, scenario] of Object.entries(SCENARIOS)) {
      if (only && !only.includes(name)) continue;
      console.log(`\n▶ ${name} (clock ${scenario.now})`);
      await startServer(scenario, { record: RECORD && scenario.fixtures !== "none" });
      for (const vp of Object.keys(VIEWPORTS)) {
        fs.mkdirSync(path.join(RAW, vp), { recursive: true });
        fs.mkdirSync(path.join(FULL, vp), { recursive: true });
        for (const st of STATES[name]) {
          if (st.only && st.only !== vp) continue;
          const ctx = await newContext(browser, vp, scenario);
          const page = await ctx.newPage();
          // A live-session capture must not show the finished race's result ticker from the
          // fixtures recorded after it — during the race there was no such result yet.
          if (scenario.replay) await page.route("**/api/f1results**", (r) => r.fulfill({ json: {} }));
          try {
            await st.go(page, vp);
            await page.screenshot({ path: path.join(RAW, vp, `${st.id}.png`) });
            if (st.elements && vp === "desktop") await captureElements(page, st.id);
            if (st.full) {
              if (st.cleanFull) await minimizeRaceControl(page);
              await page.evaluate(() => window.scrollTo(0, 0));
              await settle(page, 600);
              await page.screenshot({ path: path.join(FULL, vp, `${st.id}.png`), fullPage: true });
            }
            console.log(`  ✓ ${vp}/${st.id}`);
          } catch (e) {
            failures.push(`${vp}/${st.id}: ${e.message.split("\n")[0]}`);
            console.log(`  ✗ ${vp}/${st.id} — ${e.message.split("\n")[0]}`);
          } finally {
            await ctx.close();
          }
        }
      }
    }
  } finally {
    await browser.close();
    await stopServer();
  }
  const misses = path.join(FIXTURES, "misses.log");
  if (fs.existsSync(misses)) console.log(`\nUnrecorded requests (run with --record):\n${fs.readFileSync(misses, "utf8")}`);
  if (failures.length) {
    console.log(`\n${failures.length} state(s) failed:\n  ${failures.join("\n  ")}`);
    process.exitCode = 1;
  }
}

await main();
