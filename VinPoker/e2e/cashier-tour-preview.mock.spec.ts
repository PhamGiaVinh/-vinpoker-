import { expect, test, type Page } from "@playwright/test";

const clubId = "10000000-0000-4000-8000-000000000071";
const tourA = "20000000-0000-4000-8000-000000000071";
const tourB = "20000000-0000-4000-8000-000000000072";
const playerId = "30000000-0000-4000-8000-000000000071";
const registrationA = "40000000-0000-4000-8000-000000000071";
const registrationB = "40000000-0000-4000-8000-000000000072";
const shiftId = "50000000-0000-4000-8000-000000000071";
const expiry = 4_102_444_800;
const token = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJleHAiOjQxMDI0NDQ4MDAsInN1YiI6IjMwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDA3MSJ9.";
const user = {
  id: playerId, aud: "authenticated", role: "authenticated", email: "cashier@example.test",
  app_metadata: {}, user_metadata: {}, identities: [], created_at: "2026-08-09T00:00:00.000Z",
};
const playerA = "Nguyễn Thị Thu ngân kiểm tra tên khách rất dài Tour A";
const row = (id: string, name: string, reference: string) => ({
  id, status: "pending", player_name: name, phone: "0900000071", member_card_id: null,
  reference_code: reference, total_pay: 6_600_000, received: 0, bucket: "counter",
  receipt_code: null, table_number: null, seat_number: null,
  legacy_detail_missing: false, cashier_seating_error: null,
});

async function installMockSession(page: Page, requests: string[]) {
  await page.addInitScript(({ session, sessionExpiry, sessionToken }) => {
    localStorage.setItem("sb-127-auth-token", JSON.stringify({
      access_token: sessionToken, refresh_token: "mock-refresh-token",
      expires_in: sessionExpiry - Math.floor(Date.now() / 1000), expires_at: sessionExpiry,
      token_type: "bearer", user: session,
    }));
  }, { session: user, sessionExpiry: expiry, sessionToken: token });

  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    requests.push(`${request.method()} ${path}`);
    const json = (body: unknown) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify(body),
    });
    if (path.endsWith("/auth/v1/user")) return json(user);
    if (path.endsWith("/rpc/get_my_ops_capability_scope")) return json([{
      club_id: clubId, can_owner: false, can_floor: false, can_cashier: true,
      can_tracker: false, can_dealer_control: false, can_accountant: false,
      can_chip_master: false, can_marketer: false, can_fnb_cashier: false,
      can_fnb_server: false, can_fnb_kitchen: false,
    }]);
    if (path.endsWith("/rpc/get_my_ops_global_capability")) return json([{ is_super_admin: false }]);
    if (path.endsWith("/clubs")) return json([{ id: clubId, name: "CLB TEST" }]);
    if (path.endsWith("/tournaments")) return json([
      { id: tourA, name: "Tour A · 10:00", start_time: "2026-09-17T03:00:00Z", status: "registering", registration_closed_at: null },
      { id: tourB, name: "Tour B · 11:00", start_time: "2026-09-17T04:00:00Z", status: "registering", registration_closed_at: null },
    ]);
    if (path.endsWith("/cashier_till_shifts")) {
      if (url.search.includes("not.is.null")) return json([]);
      return json({ id: shiftId, opening_cash: 0, opened_at: "2026-09-17T02:00:00Z" });
    }
    if (path.endsWith("/cashier_refund_requests")) return json(null);
    if (path.endsWith("/rpc/cashier_shift_summary_v1")) return json({
      ok: true, shift_id: shiftId,
      totals: { cash_in: 0, cash_out: 0, bank_in: 0, bank_out: 0, unallocated_bank: 0, cash_adjustments: 0 },
    });
    if (path.endsWith("/rpc/cashier_tour_issues_v1")) return json({ ok: true, sepay_unavailable: false, shown: 0, rows: [] });
    if (path.endsWith("/rpc/cashier_tour_worklist_v1")) {
      const input = request.postDataJSON() as { p_tournament_id: string; p_query: string };
      const rows = input.p_query?.toUpperCase().includes("BETA") ? []
        : input.p_tournament_id === tourA ? [row(registrationA, playerA, "VINREGA071")]
          : [row(registrationB, "Khách Tour B", "VINREGB072")];
      return json({ ok: true, enabled: true, updated_at: "2026-09-17T03:05:00Z",
        counts: { counter: rows.length, completed: 0, waiting_seat: 0, needs_review: 0, total: rows.length }, rows });
    }
    if (path.endsWith("/rpc/cashier_lookup_tour_v1")) {
      const input = request.postDataJSON() as { p_query: string; p_serving_tournament_id: string };
      return json({ ok: true, rows: input.p_serving_tournament_id === tourA && input.p_query.toUpperCase().includes("BETA")
        ? [{ registration_id: registrationB, tournament_id: tourB, tournament_name: "Tour B · 11:00", player_name: "Khách Tour B" }] : [] });
    }
    if (path.includes("/rpc/")) return json([]);
    if (path.includes("/rest/v1/")) return json([]);
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
}

for (const width of [375, 430, 1280]) {
  test(`Tour Cashier preview fits ${width}px and restores scanner focus`, async ({ page }) => {
    const requests: string[] = [];
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await installMockSession(page, requests);
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/ops/cashier/tour?club=${clubId}`);
    await expect(page.getByText("PREVIEW", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Tour A · 10:00/ }).first().click();
    const scanner = page.getByPlaceholder("Quét QR, thẻ hội viên, mã CK; hoặc tìm tên, số điện thoại");
    await expect(scanner).toBeVisible();
    await page.getByRole("button", { name: new RegExp(playerA) }).click();
    const detail = page.getByRole("dialog", { name: new RegExp(playerA) });
    await expect(detail).toBeVisible();
    await expect(detail.getByText("6.600.000 VND").first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/cashier-tour-${width}.png` });
    await page.keyboard.press("Escape");
    await expect(detail).toHaveCount(0);
    await expect(scanner).toBeFocused();
    expect(pageErrors).toEqual([]);
    expect(requests.some((request) => /cashier_record_cash_buyin_v1|cashier_open_shift_v1/u.test(request))).toBe(false);
  });
}

test("Tour B scan warns before switching and clears Tour A cash detail", async ({ page }) => {
  const requests: string[] = [];
  await installMockSession(page, requests);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/ops/cashier/tour?club=${clubId}`);
  await page.getByRole("button", { name: /Tour A · 10:00/ }).first().click();
  await page.getByRole("button", { name: new RegExp(playerA) }).click();
  await expect(page.getByRole("dialog", { name: new RegExp(playerA) })).toBeVisible();
  await page.getByRole("button", { name: /Tour B · 11:00/ }).first().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const scanner = page.getByPlaceholder("Quét QR, thẻ hội viên, mã CK; hoặc tìm tên, số điện thoại");
  await expect(scanner).toHaveValue("");
  await page.getByRole("button", { name: /Tour A · 10:00/ }).first().click();
  await scanner.fill("BETACODE");
  await expect(page.getByText("Khách Tour B thuộc Tour B · 11:00. Đổi tour trước khi thu tiền.")).toBeVisible();
  await page.getByRole("button", { name: "Đổi sang tour này" }).click();
  await expect(scanner).toHaveValue("");
  await expect(page.getByRole("button", { name: /Khách Tour B/ })).toBeVisible();
  expect(requests.some((request) => /cashier_record_cash_buyin_v1/u.test(request))).toBe(false);
});
