// Madrid race, lap 1: every gap is under a second, so Battles waits for the order to settle.
import { scenarioTest, expect, openHome } from "./fixtures.mjs";
import { waitForTracking } from "../lib/browser.mjs";

const test = scenarioTest("race-start");

test("battles wait until lap 2", async ({ page }) => {
  await openHome(page);
  await waitForTracking(page);
  const battles = page.locator('[aria-label="Battles"]');
  await expect(battles).toContainText("From lap 2");
  await expect(battles.locator("li[data-behind]")).toHaveCount(0);
});
