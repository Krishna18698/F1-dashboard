// Every upstream unreachable: the page must still render and say so, not crash.
import { scenarioTest, expect, openHome } from "./fixtures.mjs";

const test = scenarioTest("offline");

test("upstream down: page renders with its fallbacks", async ({ page }) => {
  const res = await openHome(page);
  expect(res.status()).toBe(200);
  await expect(page.locator("h1")).toContainText("Pit Wall");
  await expect(page.getByText("Standings unavailable right now.").first()).toBeVisible();
});
