import { expect, test, type Page } from "@playwright/test";

const clubId = "10000000-0000-4000-8000-000000000001";
const tournamentId = "20000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000001";
const futureExpiry = 4_102_444_800;
const mockJwt = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJleHAiOjQxMDI0NDQ4MDAsInN1YiI6IjAwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMSJ9.";

const operatorScope = [{
  club_id: clubId,
  can_owner: true,
  can_floor: true,
  can_cashier: true,
  can_tracker: false,
  can_dealer_control: false,
  can_accountant: false,
  can_chip_master: false,
  can_marketer: false,
  can_fnb_cashier: false,
  can_fnb_server: false,
  can_fnb_kitchen: false,
}];

const tournament = {
  id: tournamentId,
  club_id: clubId,
  name: "CODEX FLOOR WORKSPACE TEST",
  status: "live",
  start_time: "2026-08-09T08:00:00.000Z",
  buy_in: 1_000_000,
  starting_chips: 30_000,
  max_players: 90,
  current_players: 0,
  current_level: 1,
  duration_minutes: 0,
  prize_pool: 0,
  game_type: "nlh",
  description: null,
};

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
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (body: unknown) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
    if (path.endsWith("/rpc/get_my_ops_capability_scope")) return json(operatorScope);
    if (path.endsWith("/rpc/get_my_ops_global_capability")) return json([{ is_super_admin: false }]);
    if (path.endsWith("/clubs")) return json([{ id: clubId, name: "HSOP TEST" }]);
    if (path.endsWith("/tournaments")) {
      const wantsObject = (request.headers().accept ?? "").includes("application/vnd.pgrst.object");
      return json(wantsObject ? tournament : [tournament]);
    }
    if (path.includes("/rpc/")) return json([]);
    if (path.includes("/rest/v1/")) return json([]);
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
}

const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 900 },
  { width: 1920, height: 1080 },
] as const;

test("canonical Floor workspace preserves club scope and stays responsive", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await installMockOpsSession(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/ops/floor/tournaments/${tournamentId}/screens?club=${clubId}`);

  await page.waitForTimeout(1_000);
  expect(pageErrors).toEqual([]);
  await expect(page.locator('[data-ops-action="floor.tournament.exit"]')).toBeVisible();
  await expect(page.locator('[data-ops-action="floor.screens.open_public_tv"]')).toBeVisible();
  await expect(page.locator('[data-ops-action="floor.screens.open_pairing"]')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/screens\\?club=${clubId}$`));

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
    .map((element) => ({ label: element.textContent?.trim(), rect: element.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > 0 && rect.height > 0)
    .filter(({ rect }) => rect.width < 44 || rect.height < 44));
  expect(undersizedTargets).toEqual([]);
});

test("Cashier production surface is read-only and selected-club bound", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const writeRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method())
      && !pathname.includes("/rpc/get_my_ops_")
    ) writeRequests.push(request.url());
  });
  await installMockOpsSession(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/ops/cashier?club=${clubId}`);

  await page.waitForTimeout(1_000);
  expect(pageErrors).toEqual([]);
  await expect(page.getByRole("main").getByText("READ_ONLY", { exact: true })).toBeVisible();
  await expect(page.getByText(/OPS MONEY GATE B/u)).toBeVisible();
  await expect(page.locator('[data-ops-action="cashier.refresh"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(writeRequests.filter((url) => url.includes("/rest/v1/") || url.includes("/functions/v1/"))).toEqual([]);
});
