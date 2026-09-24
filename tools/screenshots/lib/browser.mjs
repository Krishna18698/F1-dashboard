/**
 * Browser-side helpers shared by the capture script and the flow tests.
 */
import { TIMEZONE, LOCALE, VIEWPORTS } from "../config.mjs";

/** Same fixed clock as the server's preload: starts at `now`, then runs in real time. */
function fixedClock(now) {
  const R = Date;
  const off = now - R.now();
  function D(...a) {
    const d = a.length ? new R(...a) : new R(R.now() + off);
    return new.target ? d : d.toString();
  }
  D.prototype = R.prototype;
  D.now = () => R.now() + off;
  D.parse = R.parse;
  D.UTC = R.UTC;
  globalThis.Date = D;
}

export async function newContext(browser, viewport, scenario) {
  const { width, height, ...device } = VIEWPORTS[viewport];
  const ctx = await browser.newContext({
    viewport: { width, height },
    ...device,
    timezoneId: TIMEZONE,
    locale: LOCALE,
    colorScheme: "light",
    reducedMotion: "no-preference",
  });
  await ctx.addInitScript(fixedClock, Date.parse(scenario.now));
  // Race Control starts collapsed to its pill, as it stays for anyone who has minimized it once;
  // the floating card otherwise sits over the map in every capture. The sheet states open it.
  await ctx.addInitScript(() => localStorage.setItem("pitwall:raceControlMinimized", "1"));
  // Nothing leaves the machine from the page either (Vercel Analytics' dev script, mostly).
  await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  return ctx;
}

/** Scrolls so the section headed `text` sits just below the top edge. */
export async function scrollToHeading(page, text, offset = 16) {
  const h = page.locator("h2, h3").filter({ hasText: text }).first();
  await h.waitFor();
  await h.evaluate((el, off) => {
    const y = el.getBoundingClientRect().top + window.scrollY - off;
    window.scrollTo({ top: y, behavior: "instant" });
  }, offset);
  await page.waitForTimeout(400);
}

/** The live section, once the map has cars on it and the board is filled. */
export async function waitForTracking(page) {
  await page.waitForFunction(
    () => {
      const map = document.querySelector('svg [aria-label="Start/finish line"]')?.closest("svg");
      const cars = map ? map.querySelectorAll("circle").length : 0;
      const rows = document.querySelectorAll("ol > li.cursor-pointer").length;
      return cars >= 20 && rows >= 20;
    },
    null,
    { timeout: 120_000 },
  );
}

export async function openRaceControl(page) {
  const pill = page.getByRole("button", { name: "Show Race Control" });
  if (await pill.isVisible().catch(() => false)) await pill.click();
  await page.getByRole("button", { name: /view all/ }).click();
  await page.waitForTimeout(800);
}

export async function minimizeRaceControl(page) {
  const b = page.getByRole("button", { name: "Minimize Race Control" });
  if (await b.isVisible().catch(() => false)) await b.click();
}

/** Brings the selected driver's telemetry card fully into view, as low on screen as it fits. */
export async function showTelemetry(page) {
  const card = page.locator(".carbon-bg.mt-3").first();
  await card.waitFor({ timeout: 15_000 });
  await card.evaluate((el) => {
    const r = el.getBoundingClientRect();
    window.scrollTo({ top: r.bottom + window.scrollY - window.innerHeight + 76, behavior: "instant" });
  });
  await page.waitForTimeout(400);
}
