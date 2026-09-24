// Madrid qualifying, into Q3 (clock 2026-09-12 14:45Z).
import { scenarioTest, expect, openHome } from "./fixtures.mjs";
import { waitForTracking } from "../lib/browser.mjs";

const test = scenarioTest("quali");

test("qualifying: best-lap board with eliminated drivers greyed out", async ({ page }) => {
  await openHome(page);
  await waitForTracking(page);
  await expect(page.getByText(/Spanish Grand Prix · Qualifying/).first()).toBeVisible();
  expect(await page.locator("ol > li.cursor-pointer").count()).toBe(22);
  expect(await page.locator("ol > li.cursor-pointer.opacity-50").count()).toBeGreaterThan(0);
});

test("qualifying: the map's clock chip reads exactly what the board's segment clock reads", async ({ page }) => {
  await openHome(page);
  await waitForTracking(page);
  for (let i = 0; i < 4; i++) {
    const r = await page.evaluate(() => ({
      chip: document.querySelector('[aria-label="Session clock"]')?.innerText.replace(/\s+/g, " ").trim(),
      board: document.querySelector('[title="Time remaining in this segment"]')?.textContent?.trim(),
    }));
    expect(r.chip).toMatch(/^Q3 \d+:\d{2}$/);
    expect(r.chip).toBe(`Q3 ${r.board}`);
    await page.waitForTimeout(1300);
  }
});
