import { expect, test, type Page } from "@playwright/test";

const clubA = "10000000-0000-4000-8000-000000000001";
const clubB = "10000000-0000-4000-8000-000000000002";
const userId = "00000000-0000-4000-8000-000000000009";
const futureExpiry = 4_102_444_800;
const mockJwt = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJleHAiOjQxMDI0NDQ4MDAsInN1YiI6IjAwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwOSJ9.";

const ownerScope = [clubA, clubB].map((club_id) => ({
  club_id,
  can_owner: true,
  can_floor: false,
  can_cashier: false,
  can_tracker: false,
  can_dealer_control: false,
  can_accountant: false,
  can_chip_master: false,
  can_marketer: false,
  can_fnb_cashier: false,
  can_fnb_server: false,
  can_fnb_kitchen: false,
}));

async function installOwnerSession(page: Page, requests: string[]) {
  await page.addInitScript(({ token, expiry, actor }) => {
    localStorage.setItem("sb-127-ops-auth-token", JSON.stringify({
      access_token: token,
      refresh_token: "mock-refresh-token",
      expires_in: expiry - Math.floor(Date.now() / 1000),
      expires_at: expiry,
      token_type: "bearer",
      user: {
        id: actor,
        aud: "authenticated",
        role: "authenticated",
        email: "owner@example.test",
        app_metadata: {},
        user_metadata: {},
        identities: [],
        created_at: "2026-08-10T00:00:00.000Z",
      },
    }));
  }, { token: mockJwt, expiry: futureExpiry, actor: userId });

  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    requests.push(`${request.method()} ${path}`);
    const json = (body: unknown) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
    if (path.endsWith("/rpc/get_my_ops_capability_scope")) return json(ownerScope);
    if (path.endsWith("/rpc/get_my_ops_global_capability")) return json([{ is_super_admin: false }]);
    if (path.endsWith("/clubs")) return json([
      { id: clubA, name: "TEST_CLUB_A" },
      { id: clubB, name: "TEST_CLUB_B" },
    ]);
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
}

test("Owner opens Báo cáo ngày, switches clubs, refreshes and never writes", async ({ page }, testInfo) => {
  const requests: string[] = [];
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await installOwnerSession(page, requests);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/ops/select-module");

  const digestRow = page.getByRole("heading", { name: "Báo cáo ngày" }).locator("xpath=../../..");
  await expect(digestRow.getByText("Chỉ đọc")).toBeVisible();
  await digestRow.getByRole("button", { name: "Mở" }).click();
  await page.getByRole("button", { name: /TEST_CLUB_A/u }).click();

  await expect(page.getByRole("heading", { name: "Một ngày vận hành, nhìn trong 60 giây" })).toBeVisible();
  await expect(page.getByText("Tạm tính", { exact: true })).toBeVisible();
  await expect(page.getByText("1.200.000 ₫", { exact: true })).toBeVisible();
  await expect(page.getByText("300.000 ₫", { exact: true })).toBeVisible();
  await expect(page.getByText("3.000.000 ₫", { exact: true })).toBeVisible();
  await expect(page.getByText("1.500.000 ₫", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("owner-digest-desktop.png"), fullPage: true });

  await page.getByRole("button", { name: "Làm mới" }).click();
  await expect(page.getByText("1.200.000 ₫", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Đổi CLB" }).click();
  await page.getByRole("button", { name: /TEST_CLUB_B/u }).click();
  await expect(page.getByText("250.000 ₫", { exact: true })).toBeVisible();
  await expect(page.getByText("125.000 ₫", { exact: true })).toBeVisible();
  await expect(page.getByText("500.000 ₫", { exact: true })).toBeVisible();
  await expect(page.getByText("700.000 ₫", { exact: true })).toBeVisible();
  await expect(page.getByText("1.200.000 ₫", { exact: true })).toHaveCount(0);

  for (const viewport of [
    { name: "mobile", width: 360, height: 800 },
    { name: "laptop", width: 1024, height: 768 },
    { name: "desktop", width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`owner-digest-${viewport.name}-club-b.png`), fullPage: true });
  }

  const undersizedTargets = await page.locator("button, a").evaluateAll((elements) => elements
    .filter((element) => {
      const style = getComputedStyle(element);
      return style.visibility !== "hidden" && style.display !== "none";
    })
    .map((element) => element.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .filter((rect) => rect.width < 44 || rect.height < 44));
  expect(undersizedTargets).toEqual([]);
  expect(requests.filter((request) => ![
    "POST /rest/v1/rpc/get_my_ops_capability_scope",
    "POST /rest/v1/rpc/get_my_ops_global_capability",
    "GET /rest/v1/clubs",
  ].includes(request))).toEqual([]);
  expect(consoleErrors).toEqual([]);
  await expect(page.locator(".vite-error-overlay")).toHaveCount(0);
});
