// Madrid FP3 during its red flag, inside the stretch where F1 held the session clock (15:38).
import { scenarioTest, expect, openHome } from "./fixtures.mjs";
import { waitForTracking } from "../lib/browser.mjs";

const test = scenarioTest("practice-redflag");

test("practice red flag: clock chip holds F1's frozen figure and matches the board", async ({ page }) => {
  await openHome(page);
  await waitForTracking(page);
  await expect(page.getByText("RED FLAG", { exact: true })).toBeVisible();
  const read = () =>
    page.evaluate(() => ({
      chip: document.querySelector('[aria-label="Session clock"]')?.innerText.replace(/\s+/g, " ").trim(),
      board: document.querySelector('[title="Time remaining in this session"]:not([aria-label])')?.textContent?.trim(),
    }));
  const a = await read();
  await page.waitForTimeout(4000);
  const b = await read();
  expect(a.chip).toBe("TIME LEFT 15:38");
  expect(a.board).toBe("15:38");
  expect(b).toEqual(a); // held, not ticking down
});
