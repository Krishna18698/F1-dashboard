// Madrid race day, mid-race (clock 2026-09-13 13:55Z), the archived race played through the live path.
import { scenarioTest, expect, openHome } from "./fixtures.mjs";
import { waitForTracking } from "../lib/browser.mjs";

const test = scenarioTest("race");

test("race day: hero and schedule go live, tracker follows the race", async ({ page }) => {
  await openHome(page);
  await expect(page.locator("main section").first()).toContainText(/Race\s*·\s*Live/);
  await waitForTracking(page);

  const live = page.locator("h3", { hasText: "Live Tracking" });
  await expect(live.getByText("LIVE", { exact: true })).toBeVisible();
  await expect(page.getByText(/LAP \d+\/57/)).toBeVisible();

  // Madrid's bundled outline: 23 corner labels (1–22 plus 5A) and the start/finish line.
  const map = page.locator('svg:has([aria-label="Start/finish line"])');
  const labels = await map.locator("text").allTextContents();
  for (const c of ["1", "5A", "12", "22"]) expect(labels).toContain(c);
  expect(await page.locator("ol > li.cursor-pointer").count()).toBe(22);

  const third = page.locator("ol > li.cursor-pointer").nth(2);
  const tla = (await third.innerText()).match(/\b[A-Z]{3}\b/)[0];
  await third.click();
  await expect(page.locator(".carbon-bg.mt-3").first()).toContainText(tla);
});

test("corner numbers: all 23 still drawn, now in the quieter style", async ({ page }) => {
  await openHome(page);
  await waitForTracking(page);
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll('svg:has([aria-label="Start/finish line"]) text')].map((t) => ({
      n: t.textContent,
      weight: t.getAttribute("font-weight"),
      opacity: t.getAttribute("fill-opacity"),
    })),
  );
  const corners = labels.filter((l) => /^\d+A?$/.test(l.n));
  expect(corners.map((c) => c.n)).toEqual(["1", "2", "3", "4", "5", "5A", ...Array.from({ length: 17 }, (_, i) => String(i + 6))]);
  for (const c of corners) expect([c.weight, c.opacity]).toEqual(["600", "0.6"]);
});

test("heat trail: only for the selected car, attached to it, and on the track", async ({ page }) => {
  await openHome(page);
  await waitForTracking(page);
  await page.waitForTimeout(3000);
  const trail = page.locator('[aria-label="Selected car trail"]');
  await expect(trail).toBeHidden();

  const row = page.locator("ol > li.cursor-pointer").nth(2);
  await row.click();
  await page.waitForTimeout(9000); // ~8 s of history to draw from

  const t = await page.evaluate(() => {
    const g = document.querySelector('[aria-label="Selected car trail"]');
    const segs = [...g.querySelectorAll("line")]
      .filter((l) => l.style.visibility === "visible")
      .map((l) => ["x1", "y1", "x2", "y2"].map((a) => +l.getAttribute(a)));
    const dot = document.querySelector('svg g[data-num] circle[r="22"]').parentElement;
    const [, dx, dy] = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(dot.getAttribute("transform")).map(Number);
    const path = document.querySelector('svg path[stroke="#f4f4f6"]');
    const L = path.getTotalLength();
    const outline = Array.from({ length: 3001 }, (_, i) => path.getPointAtLength((L * i) / 3000));
    const off = (x, y) => Math.min(...outline.map((p) => Math.hypot(p.x - x, p.y - y)));
    const far = Math.max(0, ...segs.flatMap((s) => [off(s[0], s[1]), off(s[2], s[3])]));
    return { groupVisible: g.style.visibility, n: segs.length, head: segs.length ? Math.hypot(segs[0][0] - dx, segs[0][1] - dy) : null, far };
  });
  expect(t.groupVisible).toBe("visible");
  expect(t.n).toBeGreaterThanOrEqual(8);
  expect(t.head).toBeLessThan(3); // the tail starts at the dot itself
  expect(t.far).toBeLessThan(15); // every point on the circuit (SVG units; the track stroke is 12)

  await row.click(); // deselect
  await page.waitForTimeout(500);
  await expect(trail).toBeHidden();
});

test("battles: exactly the pairs within 1 s on the timing board, whole list, over time", async ({ page }) => {
  await openHome(page);
  await waitForTracking(page);
  let matchedWithPairs = 0;
  for (let i = 0; i < 12; i++) {
    const r = await page.evaluate(() => {
      // Cars the map is not drawing are in the pit lane or out — neither is racing anyone.
      const hidden = new Set(
        [...document.querySelectorAll('svg:has([aria-label="Start/finish line"]) g[data-num]')]
          .filter((g) => g.style.visibility === "hidden")
          .map((g) => g.querySelector("text")?.textContent),
      );
      const rows = [...document.querySelectorAll("ol > li.cursor-pointer")].map((li) => {
        const parts = li.innerText.split("\n").map((s) => s.trim()).filter(Boolean);
        return { pos: Number(parts[0]), tla: parts[1], interval: parts[parts.length - 1] };
      });
      rows.sort((a, b) => a.pos - b.pos);
      const expected = [];
      for (let k = 1; k < rows.length; k++) {
        const m = /^\+?(\d+(?:\.\d+)?)$/.exec(rows[k].interval);
        if (!m || Number(m[1]) > 1) continue;
        if (hidden.has(rows[k].tla) || hidden.has(rows[k - 1].tla)) continue;
        expected.push(`${rows[k].tla}>${rows[k - 1].tla}`);
      }
      const shown = [...document.querySelectorAll('[aria-label="Battles"] li[data-behind]')].map((li) => {
        const t = li.innerText.split("\n").map((s) => s.trim()).filter(Boolean);
        return `${t[0]}>${t[t.length - 1]}`;
      });
      return { expected: expected.slice(0, 4), shown };
    });
    expect(r.shown).toEqual(r.expected);
    if (r.shown.length) matchedWithPairs++;
    await page.waitForTimeout(2500);
  }
  expect(matchedWithPairs, "at least one sample should contain a real battle").toBeGreaterThan(0);
});

test("race: no session clock chip on the map; the lap counter keeps that corner", async ({ page }) => {
  await openHome(page);
  await waitForTracking(page);
  await expect(page.locator('[aria-label="Session clock"]')).toHaveCount(0);
  await expect(page.getByText(/LAP \d+\/57/)).toBeVisible();
});
