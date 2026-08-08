import { expect, test, type Page } from "@playwright/test";

const clubId = "10000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000001";
const futureExpiry = 4_102_444_800;
const mockJwt = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJleHAiOjQxMDI0NDQ4MDAsInN1YiI6IjAwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMSJ9.";

const ownerScope = [{
  club_id: clubId,
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
}];

async function installMockOpsSession(page: Page) {
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
        created_at: "2026-08-09T00:00:00.000Z",
      },
    }));
  }, { token: mockJwt, expiry: futureExpiry, actor: userId });

  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
    if (path.endsWith("/rpc/get_my_ops_capability_scope")) return json(ownerScope);
    if (path.endsWith("/rpc/get_my_ops_global_capability")) return json([{ is_super_admin: false }]);
    if (path.endsWith("/clubs")) return json([{ id: clubId, name: "HSOP TEST" }]);
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
}

test("Ops Control Deck renders the conservative registry without horizontal overflow", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installMockOpsSession(page);
  await page.goto("/ops/select-module");

  await expect(page.getByRole("heading", { name: "Một lối vào cho mọi công việc vận hành" })).toBeVisible();
  await expect(page.getByText("Kế toán vận hành", { exact: true })).toBeVisible();
  await expect(page.getByText("ACCOUNTANT_PAYROLL_GUARD_NOT_LIVE", { exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Mở" })).toHaveCount(8);
  for (const viewport of [
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1280, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const undersizedTargets = await page.locator("button, a").evaluateAll((elements) => elements
    .filter((element) => {
      const style = getComputedStyle(element);
      return style.visibility !== "hidden" && style.display !== "none";
    })
    .map((element) => ({ label: element.textContent?.trim(), rect: element.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width < 44 || rect.height < 44));
  expect(undersizedTargets).toEqual([]);
  expect(consoleErrors).toEqual([]);
  await expect(page.locator(".vite-error-overlay")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("ops-control-deck-mobile.png"), fullPage: true });
});

test("blocked direct route does not mount a module data hook", async ({ page }, testInfo) => {
  const moduleRequests: string[] = [];
  await page.setViewportSize({ width: 1280, height: 900 });
  await installMockOpsSession(page);
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (!pathname.includes("get_my_ops") && !pathname.endsWith("/clubs")) moduleRequests.push(pathname);
  });
  await page.goto(`/ops/accountant?club=${clubId}`);

  await expect(page.getByRole("heading", { name: "Kế toán vận hành" })).toBeVisible();
  await expect(page.getByText("ACCOUNTANT_PAYROLL_GUARD_NOT_LIVE", { exact: true })).toBeVisible();
  expect(moduleRequests.filter((path) => path.includes("rpc/") || path.includes("rest/v1"))).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("ops-blocked-desktop.png"), fullPage: true });
});
