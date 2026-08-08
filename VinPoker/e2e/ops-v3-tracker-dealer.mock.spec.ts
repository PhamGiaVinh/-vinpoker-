import { expect, test, type Page } from "@playwright/test";

const clubId = "10000000-0000-4000-8000-000000000003";
const tournamentId = "20000000-0000-4000-8000-000000000003";
const tableId = "30000000-0000-4000-8000-000000000003";
const dealerId = "40000000-0000-4000-8000-000000000003";
const userId = "00000000-0000-4000-8000-000000000003";
const futureExpiry = 4_102_444_800;
const mockJwt = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJleHAiOjQxMDI0NDQ4MDAsInN1YiI6IjAwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMyJ9.";

const operatorScope = [{
  club_id: clubId,
  can_owner: false,
  can_floor: false,
  can_cashier: false,
  can_tracker: true,
  can_dealer_control: true,
  can_accountant: false,
  can_chip_master: false,
  can_marketer: false,
  can_fnb_cashier: false,
  can_fnb_server: false,
  can_fnb_kitchen: false,
}];

const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 900 },
  { width: 1920, height: 1080 },
] as const;

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
    const json = (body: unknown) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
    if (path.endsWith("/rpc/get_my_ops_capability_scope")) return json(operatorScope);
    if (path.endsWith("/rpc/get_my_ops_global_capability")) return json([{ is_super_admin: false }]);
    if (path.endsWith("/clubs")) return json([{ id: clubId, name: "CODEX OPS TEST CLUB" }]);
    if (path.endsWith("/tournaments")) return json([{
      id: tournamentId,
      name: "CODEX TRACKER READ TEST",
      status: "live",
      start_time: "2026-08-09T08:00:00.000Z",
      current_players: 3,
      current_level: 2,
    }]);
    if (path.endsWith("/tournament_tables")) return json([{
      id: tableId,
      tournament_id: tournamentId,
      table_number: 3,
      table_name: "Bàn 3",
      status: "running",
      max_seats: 9,
    }]);
    if (path.endsWith("/tournament_seats")) return json([{ table_id: tableId }]);
    if (path.endsWith("/game_tables")) return json([{
      id: tableId,
      table_name: "Cash 3",
      table_type: "cash",
      status: "active",
    }]);
    if (path.endsWith("/dealers")) return json([{
      id: dealerId,
      full_name: "CODEX DEALER TEST",
      tier: "B",
    }]);
    if (path.endsWith("/dealer_assignments")) return json([{
      id: "50000000-0000-4000-8000-000000000003",
      table_id: tableId,
      dealer_id: dealerId,
      swing_due_at: "2026-08-09T09:00:00.000Z",
      status: "assigned",
      needs_replacement: false,
      assigned_at: "2026-08-09T08:30:00.000Z",
    }]);
    if (path.endsWith("/dealer_attendance")) return json([{
      dealer_id: dealerId,
      current_state: "assigned",
      check_in_time: "2026-08-09T08:00:00.000Z",
    }]);
    if (path.includes("/rpc/")) return json([]);
    if (path.includes("/rest/v1/")) return json([]);
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
}

async function expectResponsiveReadSurface(page: Page, route: string, action: string) {
  const pageErrors: string[] = [];
  const writeRequests: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method()) && !path.includes("/rpc/get_my_ops_")) {
      writeRequests.push(`${request.method()} ${path}`);
    }
  });
  await installMockOpsSession(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${route}?club=${clubId}`);

  await expect(page.getByRole("main").getByText("READ_ONLY", { exact: true })).toBeVisible();
  await expect(page.locator(`[data-ops-action="${action}"]`)).toBeVisible();
  await expect(page.getByRole("button", { name: /Đổi/u })).toBeVisible();
  expect(pageErrors).toEqual([]);

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const undersizedTargets = await page.locator("button, a").evaluateAll((elements) => elements
    .filter((element) => {
      const style = getComputedStyle(element);
      return style.visibility !== "hidden" && style.display !== "none";
    })
    .map((element) => element.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .filter((rect) => rect.width < 44 || rect.height < 44));
  expect(undersizedTargets).toEqual([]);
  expect(writeRequests).toEqual([]);
}

test("Tracker is an exact-club responsive read surface", async ({ page }) => {
  await expectResponsiveReadSurface(page, "/ops/tracker", "tracker.refresh");
  await expect(page.getByText("CODEX TRACKER READ TEST")).toBeVisible();
  await expect(page.getByText("Bàn 3")).toBeVisible();
});

test("Dealer Control excludes payroll and writer controls", async ({ page }) => {
  await expectResponsiveReadSurface(page, "/ops/dealer-swing", "dealer-control.refresh");
  await expect(page.getByText("CODEX DEALER TEST")).toBeVisible();
  await expect(page.getByText(/Không mount gán dealer/u)).toBeVisible();
  const moduleActions = await page.locator("[data-ops-action]").evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-ops-action")),
  );
  expect(moduleActions).toEqual(["dealer-control.refresh"]);
  await expect(page.getByRole("button", { name: /^(Gán dealer|Bắt đầu swing|Checkout|Payroll)$/iu })).toHaveCount(0);
});
