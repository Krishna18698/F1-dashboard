/**
 * One scenario per spec file: boots the app for it, hands each test a page with the fixed
 * clock, and fails the test on any uncaught page error.
 */
import { test as base, expect } from "@playwright/test";
import { SCENARIOS } from "../config.mjs";
import { startServer, stopServer, baseURL } from "../lib/app.mjs";
import { newContext } from "../lib/browser.mjs";

export function scenarioTest(name, viewport = "desktop") {
  const scenario = SCENARIOS[name];
  const test = base.extend({
    page: async ({ browser }, provide) => {
      const ctx = await newContext(browser, viewport, scenario);
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await provide(page);
      await ctx.close();
      expect(errors, "uncaught errors in the page").toEqual([]);
    },
  });
  test.describe.configure({ mode: "serial" });
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    await startServer(scenario);
  });
  test.afterAll(async () => {
    await stopServer();
  });
  return test;
}

/** Loads the home page and waits until the streamed page has replaced the loading skeleton. */
export async function openHome(page) {
  const res = await page.goto(baseURL + "/");
  await page.waitForFunction(() => !document.querySelector("[aria-busy]"), null, { timeout: 60_000 });
  return res;
}

export { expect, baseURL };
