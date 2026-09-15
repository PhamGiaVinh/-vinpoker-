import { expect, test } from "@playwright/test";

test("chip metrics and narrow mode panel contain long names and large values", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    expect(route.request().method()).toBe("GET");
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith("/tournaments")
      ? { status: "live", players_remaining: 1, current_level: 1 }
      : path.endsWith("/tournament_levels")
        ? { small_blind: 500000, big_blind: 1000000, ante: 1000000, is_break: false }
        : [{ player_name: "CODEX_FLOOR_UAT_".repeat(8), chip_count: 987654321000 }];
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
  });
  await page.goto("/e2e/fixtures/operations-responsive.html");
  await expect(page.getByText("987.654.321.000", { exact: true }).first()).toBeVisible();
  for (const width of [360, 390, 411, 768, 1024, 1280, 1920]) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Values must remain readable, not merely be wrapped to hide overflow.
    for (const value of await page.getByText("987.654.321.000", { exact: true }).all()) {
      expect((await value.boundingBox())!.height).toBeLessThanOrEqual(32);
    }
    for (const card of await page.getByRole("radio").all()) {
      const bounds = await card.boundingBox();
      expect(bounds!.width).toBeGreaterThan(250);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: `test-results/ops-responsive/chips-${width}.png`, fullPage: true });
  }
  await page.getByRole("radio", { name: /Live Tracker/ }).click();
  await expect(page.getByRole("radio", { name: /Live Tracker/ })).toHaveAttribute("aria-checked", "true");
  expect(errors).toEqual([]);
});
