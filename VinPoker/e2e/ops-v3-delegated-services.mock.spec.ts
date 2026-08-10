import { expect, test, type Page } from "@playwright/test";

const clubId = "10000000-0000-4000-8000-000000000004";
const tournamentId = "20000000-0000-4000-8000-000000000004";
const userId = "00000000-0000-4000-8000-000000000004";
const futureExpiry = 4_102_444_800;
const mockJwt = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJleHAiOjQxMDI0NDQ4MDAsInN1YiI6IjAwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwNCJ9.";

const operatorScope = [{
  club_id: clubId,
  can_owner: false,
  can_floor: false,
  can_cashier: false,
  can_tracker: false,
  can_dealer_control: false,
  can_accountant: false,
  can_chip_master: true,
  can_marketer: true,
  can_fnb_cashier: true,
  can_fnb_server: true,
  can_fnb_kitchen: true,
}];

const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 900 },
  { width: 1920, height: 1080 },
] as const;

async function installMockOpsSession(page: Page, observedRequests: string[]) {
  await page.addInitScript(({ token, expiry, actor }) => {
    localStorage.setItem("sb-127-auth-token", JSON.stringify({
      access_token: token,
      refresh_token: "mock-refresh-token",
      expires_in: expiry - Math.floor(Date.now() / 1000),
      expires_at: expiry,
      token_type: "bearer",
      user: {
        id: actor,
        aud: "authenticated",
        role: "authenticated",
        email: "operator@example.test",
        app_metadata: {},
        user_metadata: {},
        identities: [],
        created_at: "2026-08-09T00:00:00.000Z",
      },
    }));
  }, { token: mockJwt, expiry: futureExpiry, actor: userId });

  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    observedRequests.push(`${request.method()} ${path}`);
    const json = (body: unknown) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
    if (path.endsWith("/rpc/get_my_ops_capability_scope")) return json(operatorScope);
    if (path.endsWith("/rpc/get_my_ops_global_capability")) return json([{ is_super_admin: false }]);
    if (path.endsWith("/clubs")) return json([{ id: clubId, name: "CODEX SERVICE TEST CLUB" }]);
    if (path.endsWith("/tournaments")) return json([{
      id: tournamentId,
      name: "CODEX CHIP READ TEST",
      status: "live",
      start_time: "2026-08-09T08:00:00.000Z",
    }]);
    if (path.endsWith("/rpc/get_issued_chip_inventory")) return json({
      tournament_id: tournamentId,
      denominations: [{
        denomination_id: "30000000-0000-4000-8000-000000000004",
        value: 5_000,
        color: "red",
        issued_count_total: 90,
      }],
      total_value: 450_000,
      reconciliation_value: 450_000,
      reconciled: true,
    });
    if (path.includes("/rpc/")) return json([]);
    if (path.includes("/rest/v1/")) return json([]);
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
}

test("Chip Ops is responsive and only invokes its fixed read contract", async ({ page }) => {
  const observedRequests: string[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await installMockOpsSession(page, observedRequests);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/ops/chip-ops?club=${clubId}&t=${tournamentId}`);

  await expect(page.getByRole("main").getByText("READ_ONLY", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Giải đấu" })).toHaveValue(tournamentId);
  await expect(page.getByText("450.000").first()).toBeVisible();
  await expect(page.locator('[data-ops-action="chip-ops.refresh"]')).toBeVisible();
  expect(pageErrors).toEqual([]);

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const undersizedTargets = await page.locator("button, a, select").evaluateAll((elements) => elements
    .filter((element) => {
      const style = getComputedStyle(element);
      return style.visibility !== "hidden" && style.display !== "none";
    })
    .map((element) => element.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .filter((rect) => rect.width < 44 || rect.height < 44));
  expect(undersizedTargets).toEqual([]);

  const moduleActions = await page.locator("[data-ops-action]").evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-ops-action")),
  );
  expect(moduleActions).toEqual(["chip-ops.refresh"]);
  expect(observedRequests.some((request) => request.endsWith("/rpc/get_issued_chip_inventory"))).toBe(true);
  expect([...new Set(observedRequests.filter((request) => /^POST /u.test(request)))].sort()).toEqual([
    "POST /rest/v1/rpc/get_my_ops_capability_scope",
    "POST /rest/v1/rpc/get_my_ops_global_capability",
    "POST /rest/v1/rpc/get_issued_chip_inventory",
  ].sort());
});

for (const route of ["/ops/fnb/counter", "/ops/fnb/serve", "/ops/fnb/kitchen", "/ops/fnb/admin", "/ops/marketing"]) {
  test(`${route} remains disabled and mounts no service data hook`, async ({ page }) => {
    const observedRequests: string[] = [];
    await installMockOpsSession(page, observedRequests);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${route}?club=${clubId}`);

    await expect(page.getByRole("main").getByText("DISABLED", { exact: true })).toBeVisible();
    await expect(page.locator("[data-ops-action]")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(observedRequests.some((request) => /fnb_|marketing_/u.test(request))).toBe(false);
  });
}
