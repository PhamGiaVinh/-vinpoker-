import { expect, test, type Page } from "@playwright/test";

const clubId = "10000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000001";
const futureExpiry = 4_102_444_800;
const mockJwt = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJleHAiOjQxMDI0NDQ0ODAwLCJzdWIiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEifQ.";

async function installOwnerSession(page: Page) {
  await page.addInitScript(({ token, expiry, actor }) => {
    localStorage.setItem("sb-127-auth-token", JSON.stringify({
      access_token: token,
      refresh_token: "mock-refresh-token",
      expires_in: expiry - Math.floor(Date.now() / 1000),
      expires_at: expiry,
      token_type: "bearer",
      user: { id: actor, aud: "authenticated", role: "authenticated", email: "owner@example.test", app_metadata: {}, user_metadata: {}, identities: [], created_at: "2026-08-09T00:00:00.000Z" },
    }));
  }, { token: mockJwt, expiry: futureExpiry, actor: userId });
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (path.endsWith("/rpc/get_my_ops_capability_scope")) return json([{ club_id: clubId, can_owner: true, can_floor: false, can_cashier: false, can_tracker: false, can_dealer_control: false, can_accountant: false, can_chip_master: false, can_marketer: false, can_fnb_cashier: false, can_fnb_server: false, can_fnb_kitchen: false }]);
    if (path.endsWith("/rpc/get_my_ops_global_capability")) return json([{ is_super_admin: false }]);
    if (path.endsWith("/clubs")) return json([{ id: clubId, name: "HSOP TEST" }]);
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
}

test("flag-off parent keeps the legacy module selector without intelligence reads", async ({ page }) => {
  const intelligenceRequests: string[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.includes("get_series_club_live_pulse_v1") || path.includes("get_club_finance_summary") || path.includes("get_latest_owner_daily_digest_artifact")) intelligenceRequests.push(path);
  });
  await installOwnerSession(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/ops/select-module");
  await expect(page.getByRole("heading", { name: "Một lối vào cho mọi công việc vận hành" })).toBeVisible();
  await expect(page.getByTestId("ops-intelligence-command-center")).toHaveCount(0);
  expect(intelligenceRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
