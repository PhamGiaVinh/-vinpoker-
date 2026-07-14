import { expect, test } from "@playwright/test";

test.describe("Verified Market Jeju DEV harness", () => {
  test("desktop supports filtering and Source Detail without external data calls", async ({ page }) => {
    const externalDataRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.port === "54321" || /\.supabase\.co$/i.test(url.hostname)) externalDataRequests.push(request.url());
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/__dev/series-market");
    await expect(page.getByTestId("verified-market-dashboard")).toBeVisible();
    await expect(page.getByTestId("market-event-table")).toBeVisible();
    await page.getByPlaceholder("Event, festival, venue...").fill("no-such-public-event");
    await expect(page.getByTestId("market-no-results")).toBeVisible();
    await page.getByPlaceholder("Event, festival, venue...").fill("");
    await page.getByRole("button", { name: /Open Source Detail for Event name/ }).first().click();
    await expect(page.getByTestId("evidence-sheet")).toBeVisible();
    expect(externalDataRequests).toEqual([]);
  });

  test("390px layout uses event cards and has no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/__dev/series-market");
    const dashboard = page.getByTestId("verified-market-dashboard");
    await expect(dashboard).toBeVisible();
    await expect(page.getByTestId("market-event-card").first()).toBeVisible();
    const overflow = await page.locator("html").evaluate((root) => root.scrollWidth - root.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: /Open Source Detail for Event name/ }).first().click();
    await expect(page.getByTestId("evidence-sheet")).toBeVisible();
    const sheet = await page.getByTestId("evidence-sheet").boundingBox();
    expect(sheet!.width).toBeLessThanOrEqual(390);
  });

  test("integrity seam fails closed", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/__dev/series-market?integrity=invalid");
    await expect(page.getByTestId("verified-market-integrity-error")).toBeVisible();
    await expect(page.getByText("DEV_INTEGRITY_SEAM")).toBeVisible();
    await expect(page.getByTestId("verified-market-dashboard")).toHaveCount(0);
  });
});
