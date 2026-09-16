import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const shots = path.resolve(process.cwd(), "shots");
const viewports = [
  { name: "mobile-320", width: 320, height: 720 },
  { name: "mobile-375", width: 375, height: 812 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "mobile-414", width: 414, height: 896 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "laptop-1024", width: 1024, height: 768 },
  { name: "laptop-1366", width: 1366, height: 768 },
  { name: "laptop-1440", width: 1440, height: 900 },
  { name: "mobile-landscape", width: 844, height: 390 },
] as const;

test.beforeAll(() => fs.mkdirSync(shots, { recursive: true }));

for (const viewport of viewports) {
  test(`spectator tables fit ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/__dev/viewer-rpt?view=tables");
    await expect(page.getByRole("region", { name: "Bàn trực tiếp" })).toBeVisible();
    const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width);
    const controls = await page.locator("button").evaluateAll((buttons) => buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { width: rect.width, height: rect.height, text: button.textContent?.trim() };
    }).filter((button) => button.width > 0 && button.height > 0));
    expect(controls.filter((control) => control.width < 44 || control.height < 44)).toEqual([]);
    if (viewport.name === "mobile-390" || viewport.name === "laptop-1440") {
      await page.screenshot({ path: path.join(shots, `spectator-realtime-${viewport.name}.png`), fullPage: true });
    }
  });
}

test("payout keeps grouped amount as per-player value", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/__dev/viewer-rpt?view=leaders");
  await expect(page.getByRole("region", { name: "Chip Ranking" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Cơ cấu giải thưởng" })).toContainText("#3–5");
  await expect(page.getByRole("region", { name: "Cơ cấu giải thưởng" })).toContainText("250.000.000");
  await page.screenshot({ path: path.join(shots, "spectator-realtime-payout-mobile-390.png"), fullPage: true });
});

test("table catalog paginates beyond the first six tables", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/__dev/viewer-rpt?view=tables&tables=many");
  await expect(page.getByText("Bàn 14", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Trang bàn tiếp theo" }).click();
  await expect(page.getByText("Bàn 21", { exact: true })).toBeVisible();
});

test("simultaneous tables show only each hand's recorded cards", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/__dev/viewer-rpt?view=tables");
  const first = page.getByRole("article", { name: "Bàn 14" });
  const second = page.getByRole("article", { name: "Bàn 15" });
  await expect(first.locator('[data-card-code="QS"]')).toHaveCount(1);
  await expect(first.locator('[data-card-code="QC"]')).toHaveCount(1);
  await expect(second.locator('[data-card-code="8D"]')).toHaveCount(1);
  await expect(second.locator('[data-card-code="8H"]')).toHaveCount(1);
  await expect(first.locator('[data-card-code="8D"]')).toHaveCount(0);
  await expect(second.locator('[data-card-code="QS"]')).toHaveCount(0);
});

test("event navigation has exactly four top-level sections", async ({ page }) => {
  await page.goto("/__dev/viewer-rpt?view=updates");
  const navigation = page.getByRole("navigation", { name: "Trình xem ván đấu" });
  await expect(navigation.getByRole("link")).toHaveCount(4);
  await expect(navigation).toContainText("Cập nhật");
  await expect(navigation).toContainText("Bàn LIVE");
  await expect(navigation).toContainText("Xếp hạng");
  await expect(navigation).toContainText("Cấu trúc");
});
