import { expect, test, type Page } from "@playwright/test";

const userId = "00000000-0000-4000-8000-000000000009";
const clubId = "10000000-0000-4000-8000-000000000001";
const futureExpiry = 4_102_444_800;
const mockJwt = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJleHAiOjQxMDI0NDQ4MDAsInN1YiI6IjAwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwOSJ9.";

async function installSuperAdminSession(page: Page) {
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
        email: "owner-menu@example.test",
        app_metadata: {},
        user_metadata: {},
        identities: [],
        created_at: "2026-08-10T00:00:00.000Z",
      },
    }));
  }, { token: mockJwt, expiry: futureExpiry, actor: userId });

  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const url = new URL(route.request().url());
    const table = url.pathname.split("/").at(-1);
    let body: unknown = [];
    if (table === "user_roles") body = [{ role: "super_admin" }];
    if (table === "clubs") body = [{ id: clubId, name: "TEST CLUB", owner_id: userId }];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

test("Super Admin sees Báo cáo ngày in the existing Vận hành CLB menu", async ({ page }, testInfo) => {
  await installSuperAdminSession(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await page.getByRole("button", { name: /Vận hành|Club Operations/u }).click();
  const entry = page.getByRole("menuitem", { name: /Báo cáo ngày|Daily report/u });
  await expect(entry).toBeVisible();
  await expect(entry).toHaveAttribute("href", "/ops/daily-digest");
  await page.screenshot({ path: testInfo.outputPath("owner-digest-legacy-operations-menu.png"), fullPage: true });
});
