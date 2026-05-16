import { test, expect } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

test.describe("Bankroll Manager", () => {
  test.skip(
    !EMAIL || !PASSWORD,
    "Set E2E_EMAIL and E2E_PASSWORD env vars to run this test",
  );

  test("generates sample data and shows summary + chart", async ({ page }) => {
    // Sign in
    await page.goto("/auth");
    await page.getByLabel(/email/i).fill(EMAIL!);
    await page.getByLabel(/password|mật khẩu/i).fill(PASSWORD!);
    await page
      .getByRole("button", { name: /sign in|đăng nhập|登录|로그인/i })
      .first()
      .click();

    // Open Bankroll Manager
    await page.goto("/bankroll");
    await expect(page).toHaveURL(/bankroll/i);

    // Click "Generate Sample Data"
    const genBtn = page.getByRole("button", {
      name: /generate sample data|生成示例数据|샘플 데이터 생성/i,
    });
    await genBtn.waitFor({ state: "visible", timeout: 15_000 });
    await genBtn.click();

    // Wait for the recharts SVG to appear (cumulative profit chart)
    const chart = page.locator("svg.recharts-surface").first();
    await expect(chart).toBeVisible({ timeout: 30_000 });

    // Summary cards: assert at least 3 elements containing numeric values
    const numericValues = page.locator("text=/[-]?\\d[\\d,.]*/");
    await expect(numericValues.first()).toBeVisible();
    expect(await numericValues.count()).toBeGreaterThan(3);
  });
});
