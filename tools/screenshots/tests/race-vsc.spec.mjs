// Madrid race under the VSC (lap 15): the field is neutralised, so there are no battles to show.
import { scenarioTest, expect, openHome } from "./fixtures.mjs";
import { waitForTracking } from "../lib/browser.mjs";

const test = scenarioTest("race-vsc");

test("battles pause under the Virtual Safety Car", async ({ page }) => {
  await openHome(page);
  await waitForTracking(page);
  const battles = page.locator('[aria-label="Battles"]');
  await expect(battles).toContainText("Paused under the Virtual Safety Car");
  await expect(battles.locator("li[data-behind]")).toHaveCount(0);
});
