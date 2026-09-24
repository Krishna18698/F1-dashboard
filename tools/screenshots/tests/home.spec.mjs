// Race week between rounds (clock 2026-09-23 14:30Z): what a visitor sees on an ordinary day.
import { scenarioTest, expect, openHome } from "./fixtures.mjs";
import { waitForTracking, openRaceControl } from "../lib/browser.mjs";

const test = scenarioTest("home");

test("home page: hero counts down to the next round and every section is filled", async ({ page }) => {
  await openHome(page);
  await expect(page.locator("h1")).toContainText("Pit Wall");

  const hero = page.locator("main section").first();
  await expect(hero).toContainText("Azerbaijan");
  await expect(hero).toContainText("Practice 1 in", { ignoreCase: true });
  const before = await hero.innerText();
  await page.waitForTimeout(2200);
  expect(await hero.innerText(), "countdown should tick").not.toEqual(before);

  for (const s of ["Practice 1", "Practice 2", "Practice 3", "Qualifying", "Race"]) {
    await expect(page.locator("section", { hasText: "Weekend" }).locator("p", { hasText: new RegExp(`^${s}$`) })).toBeVisible();
  }

  const calendar = page.locator("section", { hasText: "Season Calendar" });
  await expect(calendar).toContainText("22 rounds", { ignoreCase: true });
  await expect(calendar).toContainText("R15");

  const drivers = page.locator("section", { hasText: "Drivers' Championship" });
  await expect(drivers).toContainText("Antonelli");
  await expect(page.locator("section", { hasText: "Constructors' Championship" })).toContainText("Mercedes");
  expect(await page.locator("section", { hasText: "Paddock Intel" }).locator("a").count()).toBeGreaterThanOrEqual(3);
});

test("live tracking: idle → replay of the last race → pick a driver → Race Control → back to live", async ({ page }) => {
  await openHome(page);
  await expect(page.getByText("No live Formula 1 session is currently running.")).toBeVisible();

  await page.getByRole("button", { name: "Click here" }).click();
  await waitForTracking(page);
  await expect(page.getByText(/Replay · Madrid · Spanish Grand Prix · Race/)).toBeVisible();
  await expect(page.locator('[aria-label="Start/finish line"]')).toHaveCount(1);
  expect(await page.locator("ol > li.cursor-pointer").count()).toBe(22);

  const first = page.locator("ol > li.cursor-pointer").first();
  const tla = (await first.innerText()).match(/\b[A-Z]{3}\b/)[0];
  await first.click();
  await expect(page.locator(".carbon-bg.mt-3").first()).toContainText(tla);

  await openRaceControl(page);
  const drawer = page.locator(".fixed.inset-y-0.right-0");
  await expect(drawer).toHaveClass(/translate-x-0/);
  await expect(drawer.getByRole("heading", { name: "Race Control" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(drawer).toHaveClass(/translate-x-full/);

  await page.getByRole("button", { name: "LIVE", exact: true }).click();
  await expect(page.getByText("No live Formula 1 session is currently running.")).toBeVisible();
});

test("token form: a malformed token is rejected and nothing is saved", async ({ page }) => {
  await openHome(page);
  await page.getByRole("button", { name: "Add token" }).click();
  await page.getByPlaceholder("Paste your F1 TV token").fill("not-a-real-token");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("doesn't look like a valid token")).toBeVisible();
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => /token/i.test(k)).map((k) => localStorage.getItem(k)))).not.toContain("not-a-real-token");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByPlaceholder("Paste your F1 TV token")).toHaveCount(0);
});
