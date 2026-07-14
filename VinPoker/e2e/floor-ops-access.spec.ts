import { expect, test } from "@playwright/test";

const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

for (const viewport of viewports) {
  test.describe(`Floor ops access — ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const path of ["/ops", "/ops/tables", "/ops/cashier"]) {
      test(`requires an authenticated operator for ${path}`, async ({ page }) => {
        await page.goto(path);
        await expect(page).toHaveURL(/\/auth(?:\?|$)/);
        await expect(page.getByText(/bản mẫu|mock data/i)).toHaveCount(0);
      });
    }
  });
}
