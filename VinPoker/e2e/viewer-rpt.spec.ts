import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const shots = path.resolve(process.cwd(), "shots", "viewer-rpt");
test.describe.configure({ timeout: 120_000 });
const viewports = [
  { name: "iphone-390", width: 390, height: 844 },
  { name: "iphone-430", width: 430, height: 932 },
  { name: "ipad-portrait", width: 834, height: 1112 },
  { name: "ipad-landscape", width: 1194, height: 834 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

test.beforeAll(() => fs.mkdirSync(shots, { recursive: true }));

for (const viewport of viewports) {
  test(`${viewport.name} updates has no overflow and keeps touch targets`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/__dev/viewer-rpt?view=updates&lang=vi");
    await page.locator("[data-dev-viewer-rpt]").waitFor();
    await page.waitForTimeout(300);

    const geometry = await page.locator("[data-dev-viewer-rpt]").evaluate((root) => {
      const controls = [...root.querySelectorAll("button")]
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0);
      return {
        overflow: root.scrollWidth - root.clientWidth,
        tooSmall: controls.filter((rect) => rect.width < 43.5 || rect.height < 43.5).length,
      };
    });
    expect(geometry.overflow).toBeLessThanOrEqual(1);
    expect(geometry.tooSmall).toBe(0);
    await page.screenshot({ path: path.join(shots, `${viewport.name}-updates-vi.png`), fullPage: true });
  });
}

test("mobile and tablet replay stack at the intended breakpoint", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/__dev/viewer-rpt?view=replay&lang=vi");
  const mobileRail = await page.getByTestId("replay-action-rail").boundingBox();
  const mobileFelt = await page.locator("[data-testid='felt-status-bar']").boundingBox();
  expect(mobileRail!.y).toBeGreaterThan(mobileFelt!.y);
  await page.screenshot({ path: path.join(shots, "iphone-430-replay-vi.png"), fullPage: true });

  await page.setViewportSize({ width: 1194, height: 834 });
  await page.reload();
  const tabletRail = await page.getByTestId("replay-action-rail").boundingBox();
  const tabletFelt = await page.locator("[data-testid='felt-status-bar']").boundingBox();
  expect(tabletRail!.x).toBeGreaterThan(tabletFelt!.x);
  await page.screenshot({ path: path.join(shots, "ipad-landscape-replay-vi.png"), fullPage: true });
});

test("English chrome and fallback states render", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/__dev/viewer-rpt?view=updates&lang=en");
  await expect(page.getByText("Live moments")).toBeVisible();
  await expect(page.getByText("Announcement")).toBeVisible();
  await page.screenshot({ path: path.join(shots, "iphone-430-updates-en.png"), fullPage: true });

  for (const state of ["empty", "loading", "error"] as const) {
    await page.goto(`/__dev/viewer-rpt?view=updates&state=${state}&lang=en`);
    await expect(page.locator(`[data-testid='viewer-${state}']`)).toBeVisible();
    await page.screenshot({ path: path.join(shots, `iphone-430-${state}-en.png`), fullPage: true });
  }
});
