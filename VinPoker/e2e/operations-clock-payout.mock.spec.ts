import { expect, test } from "@playwright/test";

for (const surface of ["clock", "panels"]) {
  test(`${surface}: mobile and tablet content remains reachable`, async ({ page }) => {
    const writes: string[] = [];
    await page.route("http://127.0.0.1:54321/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const isReadRpc = ["get_tournament_clock", "get_tournament_leaderboard"].some((name) => path.endsWith(`/rpc/${name}`));
      const isAllowedRead = ["GET", "HEAD"].includes(request.method()) || (request.method() === "POST" && isReadRpc);
      if (!isAllowedRead) writes.push(path);
      const level = { id: "level-test", level_number: 20, small_blind: 500000, big_blind: 1000000, ante: 1000000, duration_minutes: 20, is_break: false };
      const body = path.endsWith("/get_tournament_clock")
        ? { tournament_id: "responsive-test", status: "live", is_running: false, remaining_seconds: 1200, elapsed_seconds: 0, current_level: level, next_level: { ...level, level_number: 21 }, is_break: false, control_revision: "test-revision" }
        : path.endsWith("/get_tournament_leaderboard")
          ? { players: [{ position: 1, player_name: "Nguyễn_Văn_Tên_Dài_".repeat(8), prize: 250000000 }], prize_pool: 420000000 }
          : [{ position: 1, amount: 250000000, percentage: 60 }];
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(`/e2e/fixtures/operations-responsive.html?surface=${surface}`);
    await expect(page.getByText(surface === "clock" ? "Kết thúc đăng ký tại Level 8" : "20:00", { exact: true })).toBeVisible();
    for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1280, height: 900 }, { width: 1920, height: 1080 }]) {
      await page.setViewportSize(viewport);
      await page.screenshot({ path: `test-results/ops-responsive/${surface}-${viewport.width}.png`, fullPage: true });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (surface === "clock") {
        // Decorative background bleed is intentional; actual footer content must fit.
        await expect.poll(() => page.locator(".vpc-root").evaluate((e) => e.querySelector(".vpc-footer")!.getBoundingClientRect().bottom <= e.getBoundingClientRect().bottom + 1)).toBe(true);
      } else {
        await expect(page.getByText("20:00", { exact: true })).toBeVisible();
        await expect(page.getByTestId("tracker-readonly-roster")).toBeVisible();
      }
    }
    expect(writes).toEqual([]);
  });
}
