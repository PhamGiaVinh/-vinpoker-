import { expect, test, type Page } from "@playwright/test";

const userId = "00000000-0000-4000-8000-000000000009";
const clubId = "10000000-0000-4000-8000-000000000001";
const futureExpiry = 4_102_444_800;
const mockJwt = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJleHAiOjQxMDI0NDQ4MDAsInN1YiI6IjAwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwOSJ9.";

async function installClubOwnerSession(page: Page) {
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
        email_confirmed_at: "2026-08-10T00:00:00.000Z",
      },
    }));
  }, { token: mockJwt, expiry: futureExpiry, actor: userId });

  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const url = new URL(route.request().url());
    const table = url.pathname.split("/").at(-1);
    let body: unknown = [];
    if (table === "clubs") body = [{ id: clubId, name: "TEST CLUB", owner_id: userId }];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

test("Club Owner opens Báo cáo ngày inside the primary VinPoker session", async ({ page }, testInfo) => {
  await installClubOwnerSession(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await page.getByRole("button", { name: /Vận hành|Club Operations/u }).click();
  const entry = page.getByRole("menuitem", { name: /Báo cáo ngày|Daily report/u });
  await expect(entry).toBeVisible();
  await expect(entry).toHaveAttribute("href", "/club/admin/daily-digest");
  await entry.click();
  await expect(page).toHaveURL(/\/club\/admin\/daily-digest$/u);
  await expect(page).not.toHaveURL(/\/ops\/login/u);
  await expect(page.getByRole("heading", { name: "Một ngày vận hành, nhìn trong 60 giây" })).toBeVisible();
  await expect(page.getByText(/1\.200\.000/u)).toBeVisible();

  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: width === 320 ? 760 : 900 });
    await expect(page.locator("[data-owner-digest-report]")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`owner-digest-primary-${width}.png`), fullPage: true });
  }
});
