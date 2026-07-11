import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 120_000 });

const viewports = [
  { name: "iphone-390", width: 390, height: 844 },
  { name: "iphone-430", width: 430, height: 932 },
  { name: "ipad-portrait", width: 834, height: 1112 },
  { name: "ipad-landscape", width: 1194, height: 834 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

for (const viewport of viewports) {
  test(`${viewport.name} Live Center and Clock stay within the viewport`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: "reduce" });

    await page.goto("/live?preview=mock");
    await expect(page.getByText("VinPoker Live Center")).toBeVisible();
    await expect(page.getByText("Midnight Sakura Championship")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

    const liveTargets = await page.locator("main a, main button").evaluateAll((elements) => elements
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .filter((rect) => rect.width < 43.5 || rect.height < 43.5).length);
    expect(liveTargets).toBe(0);

    await page.goto("/clock/mock-live?preview=mock");
    await expect(page.getByText("Midnight Sakura Championship")).toBeVisible();
    await expect(page.getByText("BB Ante", { exact: true })).toBeVisible();
    await expect(page.getByText("Kayhan Mokri")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });
}

test("mobile hand history exposes named actions and verified ranking", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/__dev/viewer-rpt?view=history&lang=vi");
  await expect(page.locator("[data-dev-viewer-rpt]")).toBeVisible();
  await expect(page.getByText("Full House · 7-A").first()).toBeVisible();
  await page.getByRole("button", { name: /Lịch sử hành động/ }).first().click();
  await expect(page.getByText("KIEN", { exact: true })).toBeVisible();
  await expect(page.getByText(/Pot 18.6M/).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("mobile replay final summary keeps ranking and action digest visible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/__dev/viewer-rpt?view=replay&lang=vi");
  await expect(page.locator("[data-dev-viewer-rpt]")).toBeVisible();
  await page.getByTitle(/Tới cuối|Go to showdown/).click();
  await expect(page.getByTestId("replay-hud-rankings")).toBeVisible();
  await expect(page.getByTestId("replay-hud-action-summary")).toBeVisible();
  await expect(page.getByTestId("replay-hud-needs-resettle")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
