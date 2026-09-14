import { expect, test, type Page } from "@playwright/test";

const clubId = "10000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000001";
const eventId = "20000000-0000-4000-8000-000000000001";
const secondEventId = "20000000-0000-4000-8000-000000000002";
const asOf = "2026-08-29T10:00:00.000Z";
const mockJwt = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJleHAiOjQxMDI0NDQ4MDAsInN1YiI6IjAwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMSJ9.";
const intelligenceReadPaths = new Set([
  "/rpc/get_ops_intelligence_context_v1",
  "/rpc/get_ops_intelligence_timeline_v1",
  "/rpc/get_series_club_live_pulse_v1",
  "/rpc/get_ops_registration_pace_q0",
  "/rpc/get_ops_sepay_read_state_q0",
  "/rpc/get_club_series_events",
  "/rpc/get_tournament_prize_pool",
  "/rpc/get_club_finance_summary",
  "/rpc/get_latest_owner_daily_digest_artifact",
  "/game_tables",
  "/tournaments",
  "/dealer_assignments",
  "/dealer_attendance",
]);

test("Q1 renders the real Quant workspace, embedded views, and responsive fallback", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await installMocks(page);
  await page.clock.setFixedTime(new Date(asOf));
  await page.emulateMedia({ reducedMotion: "reduce" });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/ops/select-module");
  await expect(page.getByTestId("ops-intelligence-workspace-q1")).toBeVisible();
  await openDailyQuant(page);
  await expect(page.getByTestId("ops-quant-dashboard-q1")).toBeVisible();
  await expect(page.getByText("VINPOKER OPERATIONS INTELLIGENCE", { exact: true })).toBeVisible();
  await expect(page.getByText("RESEARCH MODEL · HISTORY FINALITY UNVERIFIED", { exact: true })).toBeVisible();
  await expect(page.getByText("Giải thích artifact · không gọi Gemini", { exact: true })).toBeVisible();
  await expect(page.getByText("Tournament pressure matrix", { exact: true })).toBeVisible();
  await expect(page.getByText("2.000.000.000 ₫", { exact: true })).toBeVisible();
  await expect(page.getByText("Required entries", { exact: true }).locator("..").getByText("1.000", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "docs/ops/evidence/quant-q1/quant-1440x900.png" });

  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(page.getByTestId("ops-quant-dashboard-q1")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "docs/ops/evidence/quant-q1/quant-1920x1080.png" });

  await page.getByRole("button", { name: "LIVE OPS" }).click();
  await expect(page.getByTestId("ops-intelligence-command-center")).toBeVisible();
  await expect(page.getByText("Ops Intelligence Command Center", { exact: true })).toHaveCount(0);
  await expect(page.getByText("8 bàn đang mở · 24 bàn cấu hình", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tài chính & Đối soát", exact: true })).toBeVisible();
  await expect(page.getByText("T08", { exact: true })).toBeVisible();
  await page.screenshot({ path: "docs/ops/evidence/quant-q1/live-ops-embedded-1920x1080.png" });

  await page.getByRole("button", { name: "DATA HEALTH" }).click();
  await expect(page.getByTestId("ops-quant-data-health-q0")).toBeVisible();
  await expect(page.getByText("Ops Quant Data Health Q0", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Nhịp đăng ký quan sát", { exact: true })).toBeVisible();
  await expect(page.getByText("SePay read state", { exact: true })).toBeVisible();
  await expect(page.getByText(/EVENT_SOURCE_NOT_APPROVED/)).toHaveCount(2);
  await expect(page.getByText(/get_ops_registration_pace_q0/)).toBeVisible();
  await expect(page.getByText(/get_ops_sepay_read_state_q0/)).toBeVisible();
  await page.screenshot({ path: "docs/ops/evidence/quant-q1/data-health-embedded-1920x1080.png" });

  await page.setViewportSize({ width: 1194, height: 834 });
  await expect(page.getByRole("heading", { name: "Một lối vào cho mọi công việc vận hành" })).toBeVisible();
  await expect(page.getByTestId("ops-intelligence-workspace-q1")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Một lối vào cho mọi công việc vận hành" })).toBeVisible();
  await expect(page.getByTestId("ops-intelligence-workspace-q1")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "docs/ops/evidence/quant-q1/mobile-fallback-390x844.png" });

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("Q1 readers stay unmounted below the desktop breakpoint", async ({ page }) => {
  const observedReads: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if ([...intelligenceReadPaths].some((suffix) => path.endsWith(suffix))) observedReads.push(path);
  });
  await installMocks(page);
  await page.setViewportSize({ width: 1194, height: 834 });
  await page.goto("/ops/select-module");
  await expect(page.getByRole("heading", { name: "Một lối vào cho mọi công việc vận hành" })).toBeVisible();
  await expect(page.getByTestId("ops-intelligence-workspace-q1")).toHaveCount(0);
  await expect.poll(() => observedReads).toEqual([]);
  expect(errors).toEqual([]);
});

test("Custom is visible, independent of turnout capacity, and retained across tabs", async ({ page }) => {
  await installMocks(page);
  await page.clock.setFixedTime(new Date(asOf));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/ops/select-module");
  await openDailyQuant(page);
  await expect(page.locator(".recharts-reference-dot, .recharts-reference-line")).toHaveCount(0);
  await expect(page.getByTestId("forecast-final-summary")).toContainText("Tổng entries cuối giải");
  await page.getByRole("button", { name: /Xem tất cả/ }).click();
  await expect(page.getByText("3 giao dịch cần đối soát", { exact: true })).toBeVisible();
  await page.getByLabel("Custom entries", { exact: true }).fill("200");
  await page.getByLabel("Ghế mỗi bàn (giả định)", { exact: true }).fill("8");
  const results = page.getByTestId("custom-results");
  await expect(results.getByText(/^Bàn cần/).locator("..")).toContainText("UNAVAILABLE");
  await page.getByLabel("Người đồng thời cao điểm (Custom)", { exact: true }).fill("80");
  await expect(results.getByText(/^Bàn cần/).locator("..").locator("dd")).toHaveText("10");
  await expect(results.getByText(/^Prize pool \(VND\)/).locator("..").locator("dd")).toHaveText("400.000.000");
  await results.locator("..").screenshot({ path: "docs/ops/evidence/quant-q1/wave1-custom.png" });
  await page.getByLabel("Custom GTD (VND)", { exact: true }).fill("-1");
  await expect(page.getByRole("alert")).toContainText("Nhập số nguyên");
  await expect(results.getByText(/^GTD \(VND\)/).locator("..").locator("dd")).toHaveText("—");
  await page.getByLabel("Custom GTD (VND)", { exact: true }).fill("0");
  await expect(results.getByText(/^GTD \(VND\)/).locator("..").locator("dd")).toHaveText("0");
  await page.getByText("Nguồn và thời điểm đọc thành công", { exact: true }).click();
  const receipt = await page.getByTestId("receipt-registration-q0").textContent();
  const backgroundReads: string[] = [];
  page.on("request", (request) => { if (/get_club_series_events|get_tournament_prize_pool|get_series_club_live_pulse_v1/.test(request.url())) backgroundReads.push(request.url()); });
  await page.getByRole("button", { name: "DATA HEALTH", exact: true }).click();
  await expect(page.getByTestId("ops-quant-dashboard-q1")).toHaveCount(0);
  await expect(page.getByTestId("ops-quant-data-health-q0")).toBeVisible();
  expect(backgroundReads).toEqual([]);
  await page.getByRole("button", { name: "QUANT", exact: true }).click();
  await expect(page.getByLabel("Custom entries", { exact: true })).toHaveValue("200");
  await expect(page.getByLabel("Custom GTD (VND)", { exact: true })).toHaveValue("0");
  await page.getByText("Nguồn và thời điểm đọc thành công", { exact: true }).click();
  await expect(page.getByTestId("receipt-registration-q0")).toHaveText(receipt!);
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Deepstack Turbo", exact: true }).click();
  await expect(page.getByLabel("Phạm vi Intelligence")).toHaveValue(`daily:${eventId}`);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Deepstack Turbo", exact: true }).click();
  await expect(page.getByLabel("Phạm vi Intelligence")).toHaveValue(`daily:${secondEventId}`);
  await expect(page.getByLabel("Custom entries", { exact: true })).toHaveValue("");
});

test("inconsistent Custom peak fails closed and recovers without changing owner inputs", async ({ page }) => {
  await installMocks(page);
  await page.clock.setFixedTime(new Date(asOf));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/ops/select-module");
  await openDailyQuant(page);
  await page.getByLabel("Custom entries", { exact: true }).fill("50");
  await page.getByLabel("Ghế mỗi bàn (giả định)", { exact: true }).fill("8");
  const peak = page.getByLabel("Người đồng thời cao điểm (Custom)", { exact: true });
  await peak.fill("80");
  await expect(page.getByRole("alert")).toHaveText("Người đồng thời cao điểm không thể lớn hơn tổng Custom entries.");
  await expect(peak).toHaveAttribute("aria-invalid", "true");
  await expect(peak).toHaveValue("80");
  const results = page.getByTestId("custom-results");
  for (const label of [/^Bàn cần/, /^Bàn còn thiếu/, /^Dealer đứng bàn còn thiếu/]) {
    const output = results.getByText(label).locator("..");
    await expect(output).toContainText("UNAVAILABLE");
    await expect(output.locator("dd")).toHaveText("—");
  }
  await expect(results.getByText(/^Prize pool \(VND\)/).locator("..").locator("dd")).toHaveText("100.000.000");
  await peak.fill("40");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(peak).toHaveAttribute("aria-invalid", "false");
  await expect(results.getByText(/^Bàn cần/).locator("..").locator("dd")).toHaveText("5");
  await expect(page.getByLabel("Custom entries", { exact: true })).toHaveValue("50");
  await page.getByLabel("Custom entries", { exact: true }).fill("");
  await peak.fill("80");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(results.getByText(/^Bàn cần/).locator("..").locator("dd")).toHaveText("10");
  await expect(results.getByText(/^Prize pool \(VND\)/).locator("..").locator("dd")).toHaveText("—");
});

test("only active tab readers refresh and clock ticks do not request data", async ({ page }) => {
  const reads: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if ([...intelligenceReadPaths].some((suffix) => path.endsWith(suffix))) reads.push(path);
  });
  await installMocks(page);
  await page.clock.install({ time: new Date(asOf) });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/ops/select-module");
  await openDailyQuant(page);
  await expect(page.getByText("Required entries", { exact: true }).locator("..")).toContainText("1.000");
  await page.getByLabel("Custom entries", { exact: true }).fill("200");
  await page.getByText("Nguồn và thời điểm đọc thành công", { exact: true }).click();
  const receipt = await page.getByTestId("receipt-registration-q0").textContent();
  const initialReads = [...reads];
  expect(initialReads.some((path) => /finance|digest/.test(path))).toBe(false);
  await page.clock.runFor(65_000);
  expect(reads).toEqual(initialReads);
  await expect(page.getByTestId("receipt-registration-q0")).toHaveText(receipt!);

  reads.length = 0;
  await page.getByRole("button", { name: "LIVE OPS", exact: true }).click();
  await expect(page.getByTestId("ops-intelligence-command-center")).toBeVisible();
  expect(reads.some((path) => /get_ops_registration_pace_q0|get_ops_sepay_read_state_q0|get_club_series_events|get_tournament_prize_pool/.test(path))).toBe(false);
  await expect(page.getByTestId("ops-quant-dashboard-q1")).toHaveCount(0);

  reads.length = 0;
  await page.getByRole("button", { name: "DATA HEALTH", exact: true }).click();
  await expect(page.getByTestId("ops-quant-data-health-q0")).toBeVisible();
  expect(reads.every((path) => /get_ops_registration_pace_q0|get_ops_sepay_read_state_q0/.test(path))).toBe(true);
  const healthReads = [...reads];
  await page.clock.runFor(65_000);
  expect(reads).toEqual(healthReads);
  await page.getByRole("button", { name: "QUANT", exact: true }).click();
  await expect(page.getByLabel("Custom entries", { exact: true })).toHaveValue("200");
  await openDailyQuant(page);
});

test("failed reads and removed events never become empty exact or another selection", async ({ page }) => {
  let failed = false;
  let removed = false;
  await installMocks(page, { registration: () => failed ? { malformed: true } : { ...registration(), events: removed ? registration().events.filter((event) => event.eventId !== eventId) : registration().events } });
  await page.clock.setFixedTime(new Date(asOf));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/ops/select-module");
  await openDailyQuant(page);
  await page.getByText("Nguồn và thời điểm đọc thành công", { exact: true }).click();
  const receipt = await page.getByTestId("receipt-registration-q0").locator("span").last().textContent();
  failed = true;
  await page.clock.setFixedTime(new Date("2026-08-29T10:00:10.000Z"));
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Không đọc được lịch CLB");
  await expect(page.getByTestId("receipt-registration-q0").locator("span").last()).toHaveText(receipt!);
  await expect(page.getByText(/EMPTY EXACT/)).toHaveCount(0);
  failed = false;
  removed = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("không tự đổi giải");
  await expect(page.getByLabel("Phạm vi Intelligence")).toHaveValue(`daily:${eventId}`);
  await page.getByRole("button", { name: "DATA HEALTH", exact: true }).click();
  await page.getByRole("button", { name: "QUANT", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("không tự đổi giải");
});

test("Custom capacity remains usable without history or prize contribution", async ({ page }) => {
  await installMocks(page, { history: () => [] });
  await page.clock.setFixedTime(new Date(asOf));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/ops/select-module");
  await openDailyQuant(page);
  await page.getByLabel("Custom entries", { exact: true }).fill("200");
  await page.getByLabel("Ghế mỗi bàn (giả định)", { exact: true }).fill("8");
  await page.getByLabel("Người đồng thời cao điểm (Custom)", { exact: true }).fill("80");
  const results = page.getByTestId("custom-results");
  await expect(results.getByText(/^Bàn cần/).locator("..").locator("dd")).toHaveText("10");
  await expect(results.getByText(/^Prize pool \(VND\)/).locator("..").locator("dd")).toHaveText("—");
});

for (const gate of ["spaces", "non-owner", "unverified-super-admin"] as const) {
  test(`${gate} mounts no Intelligence reader`, async ({ page }) => {
    const reads: string[] = [];
    page.on("request", (request) => { if ([...intelligenceReadPaths].some((suffix) => new URL(request.url()).pathname.endsWith(suffix))) reads.push(request.url()); });
    await installMocks(page, { owner: gate !== "non-owner", superAdmin: gate === "unverified-super-admin" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/ops/select-module${gate === "spaces" ? "?view=spaces" : gate === "unverified-super-admin" ? `?club=${clubId}` : ""}`);
    if (gate === "unverified-super-admin") await expect(page.getByRole("heading", { name: "Không xác thực được CLB yêu cầu" })).toBeVisible();
    else await expect(page.getByRole("heading", { name: gate === "spaces" ? "Chọn không gian làm việc" : "Một lối vào cho mọi công việc vận hành" })).toBeVisible();
    await expect(page.getByTestId("ops-intelligence-workspace-q1")).toHaveCount(0);
    expect(reads).toEqual([]);
  });
}

async function openDailyQuant(page: Page) {
  await expect(page.getByLabel("Phạm vi Intelligence")).toBeEnabled();
  await page.getByLabel("Phạm vi Intelligence").selectOption(`daily:${eventId}`);
  await page.getByRole("button", { name: "QUANT", exact: true }).click();
  await expect(page.getByTestId("ops-quant-dashboard-q1")).toBeVisible();
}

async function installMocks(page: Page, options: { registration?: () => unknown; history?: () => unknown; context?: () => unknown; timeline?: () => unknown; owner?: boolean; superAdmin?: boolean } = {}) {
  await page.addInitScript(({ token, actor, createdAt }) => {
    localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: token, refresh_token: "mock", expires_in: 2_000_000_000, expires_at: 4_102_444_800, token_type: "bearer", user: { id: actor, aud: "authenticated", role: "authenticated", email: "owner@example.test", app_metadata: {}, user_metadata: {}, identities: [], created_at: createdAt } }));
  }, { token: mockJwt, actor: userId, createdAt: asOf });
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (path.endsWith("/auth/v1/user")) return json({ id: userId, aud: "authenticated", role: "authenticated", email: "owner@example.test", app_metadata: {}, user_metadata: {}, identities: [], created_at: asOf });
    if (path.endsWith("/rpc/get_my_ops_capability_scope")) return json([{ club_id: clubId, can_owner: options.owner ?? true, can_floor: options.owner === false, can_cashier: false, can_tracker: false, can_dealer_control: false, can_accountant: false, can_chip_master: false, can_marketer: false, can_fnb_cashier: false, can_fnb_server: false, can_fnb_kitchen: false }]);
    if (path.endsWith("/rpc/get_my_ops_global_capability")) return json([{ is_super_admin: options.superAdmin ?? false }]);
    if (path.endsWith("/rpc/list_ops_clubs_for_super_admin")) return json([]);
    if (path.endsWith("/clubs")) return json([{ id: clubId, name: "VinPoker Club" }]);
    if (path.endsWith("/rpc/get_ops_intelligence_context_v1")) return json(options.context ? options.context() : contextFixture());
    if (path.endsWith("/rpc/get_ops_intelligence_timeline_v1")) {
      const body = route.request().postDataJSON() as { p_tournament_id?: string };
      return json(options.timeline ? options.timeline() : timelineFixture(false, body.p_tournament_id ?? eventId));
    }
    if (path.endsWith("/rpc/get_series_club_live_pulse_v1")) return json(pulse());
    if (path.endsWith("/rpc/get_ops_registration_pace_q0")) return json(options.registration ? options.registration() : registration());
    if (path.endsWith("/rpc/get_ops_sepay_read_state_q0")) return json(sepay());
    if (path.endsWith("/rpc/get_club_series_events")) return json(options.history ? options.history() : seriesHistory());
    if (path.endsWith("/rpc/get_tournament_prize_pool")) return json([{ prize_pool: 1_107_000_000, confirmed_entry_count: 123 }]);
    if (path.endsWith("/rpc/get_club_finance_summary")) return json({ revenue: { total: 774_540_000, rake: 56_780_000, serviceFee: 68_540_000, stakingFees: 0, payoutFees: 0, fnb: 123_000_000 }, cost: { payrollNet: 0, ptWagePaid: 0, fnbCogs: 0, compCogs: 0, clubExpenses: 0 }, net: 774_540_000 });
    if (path.endsWith("/rpc/get_latest_owner_daily_digest_artifact")) return json(null);
    if (path.endsWith("/game_tables")) return json(tables());
    if (path.endsWith("/tournaments")) return json([{ id: eventId, name: "High Roller Day 1A", status: "live", current_level: 8, average_stack: 35_200, tournament_tables: Array.from({ length: 8 }, (_, index) => ({ table_id: `table-${index + 1}`, status: "active" })) }]);
    if (path.endsWith("/dealer_assignments")) return json(assignments());
    if (path.endsWith("/dealer_attendance")) return json(Array.from({ length: 18 }, (_, index) => ({ id: `attendance-${index + 1}`, dealer_id: `dealer-${index + 1}`, check_in_time: "2026-08-29T06:00:00.000Z" })));
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
}

function contextFixture() {
  return { version: "ops-intelligence-context-v1", clubId, asOf, dailyTournaments: registration().events.map((event) => ({ tournamentId: event.eventId, name: event.eventName, status: event.eventState, startTime: event.startTime, buyIn: 2_300_000, gtd: event.eventId === eventId ? 2_000_000_000 : 900_000_000, phase: null, flightLabel: null })), festivals: [] };
}

function timelineFixture(partial = false, target = eventId) {
  const times = ["2026-08-29T06:00:00.000Z", "2026-08-29T07:00:00.000Z", "2026-08-29T08:00:00.000Z", "2026-08-29T09:00:00.000Z"];
  return {
    version: "ops-intelligence-timeline-v1", clubId, tournamentId: target, asOf,
    entries: { availability: "exact", reasonCode: null, points: times.map((at, index) => ({ at, value: [18, 42, 68, 61][index] })) },
    tables: { availability: "exact", reasonCode: null, capacityAvailability: partial ? "partial" : "exact", capacityReasonCode: partial ? "TABLE_CAPACITY_BINDING_INCOMPLETE" : null, points: times.map((at, index) => ({ at, value: [3, 6, 8, 7][index], seatCapacity: partial ? null : [27, 54, 72, 63][index] })) },
    dealers: partial ? { availability: "partial", reasonCode: "DEALER_SESSION_BINDING_INCOMPLETE", points: [] } : { availability: "exact", reasonCode: null, points: times.map((at, index) => ({ at, value: [2, 5, 8, 7][index] })) },
    gtd: { availability: "exact", reasonCode: null, guaranteeState: "available", guaranteeAmount: 2_000_000_000, points: times.map((at, index) => ({ at, value: [180_000_000, 430_000_000, 780_000_000, 1_050_000_000][index] })) },
    dealerGaps: partial ? [] : [{ from: times[0], to: times[1], maxGap: 1 }, { from: times[1], to: times[2], maxGap: 1 }],
  };
}

test("Wave 3 daily Overview renders exact aggregate step timelines", async ({ page }) => {
  const errors: string[] = [];
  const targets: unknown[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", (request) => { if (request.url().includes("get_ops_intelligence_timeline_v1")) targets.push(request.postDataJSON()); });
  await installMocks(page);
  await page.clock.setFixedTime(new Date(asOf));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/ops/select-module");
  await page.waitForTimeout(1_000);
  expect(errors).toEqual([]);
  await expect(page.getByTestId("ops-intelligence-timeline-v1")).toHaveCount(0);
  await page.getByLabel("Phạm vi Intelligence").selectOption(`daily:${eventId}`);
  const timeline = page.getByTestId("ops-intelligence-timeline-v1");
  await expect(timeline).toBeVisible();
  await expect(timeline.getByText("NGƯỜI ĐANG NGỒI")).toBeVisible();
  await expect(timeline.getByText("BÀN / DEALER")).toBeVisible();
  await expect(timeline.getByText("GTD COVERAGE")).toBeVisible();
  await expect(timeline.getByText(/DEALER GAP/)).toBeVisible();
  await expect(page.getByTestId("overview-readiness").getByText("Operational timeline")).toBeVisible();
  await expect.poll(() => JSON.stringify(targets)).toContain(eventId);
  expect(JSON.stringify(targets)).not.toContain("festivalId");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "docs/ops/evidence/wave3/wave3-daily-timeline-1440x900.png" });
  expect(errors).toEqual([]);
});

test("Wave 3 partial bindings stay visible without a dealer-shortage claim", async ({ page }) => {
  await installMocks(page, { timeline: () => timelineFixture(true) });
  await page.clock.setFixedTime(new Date(asOf));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/ops/select-module");
  await page.getByLabel("Phạm vi Intelligence").selectOption(`daily:${eventId}`);
  const timeline = page.getByTestId("ops-intelligence-timeline-v1");
  await expect(timeline.getByText(/Dealer binding chưa exact/)).toBeVisible();
  await expect(timeline.getByText(/DEALER GAP/)).toHaveCount(0);
  await timeline.getByRole("button", { name: "Nguồn" }).click();
  await expect(page.getByRole("dialog")).toContainText("TABLE_CAPACITY_BINDING_INCOMPLETE");
  await expect(page.getByRole("dialog")).toContainText("DEALER_SESSION_BINDING_INCOMPLETE");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: "docs/ops/evidence/wave3/wave3-partial-source-1440x900.png" });
});

test("Wave 2 daily Overview is default, shares cache and preserves exact selection through all views", async ({ page }) => {
  const errors: string[] = [];
  const reads: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", (request) => { if ([...intelligenceReadPaths].some((suffix) => new URL(request.url()).pathname.endsWith(suffix))) reads.push(new URL(request.url()).pathname); });
  await installMocks(page);
  await page.clock.install({ time: new Date(asOf) });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/ops/select-module");
  await expect(page.getByTestId("ops-intelligence-overview-v1")).toBeVisible();
  await expect(page.getByTestId("ops-quant-dashboard-q1")).toHaveCount(0);
  await expect(page.getByLabel("Phạm vi Intelligence")).toBeEnabled();
  await page.getByLabel("Phạm vi Intelligence").selectOption(`daily:${eventId}`);
  await expect(page.getByRole("button", { name: /Lượt vào phạm vi chọn/ })).toContainText("123");
  await expect(page.getByTestId(`schedule-${eventId}`)).toBeVisible();
  expect(reads.some((path) => /get_club_series_events|get_tournament_prize_pool|get_club_finance_summary|daily_digest/.test(path))).toBe(false);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "docs/ops/evidence/wave2/overview-daily-1440x900.png" });
  await page.getByRole("button", { name: /Lượt vào phạm vi chọn/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Source asOf");
  await expect(page.getByRole("dialog")).toContainText(eventId);
  await page.keyboard.press("Escape");
  await page.getByTestId(`schedule-${eventId}`).getByRole("button", { name: "Mở Quant" }).click();
  await expect(page.getByTestId("ops-quant-dashboard-q1")).toBeVisible();
  await page.getByLabel("Custom entries", { exact: true }).fill("200");
  for (const tab of ["LIVE OPS", "DATA HEALTH", "TỔNG QUAN", "QUANT"]) await page.getByRole("button", { name: tab, exact: true }).click();
  await expect(page.getByLabel("Custom entries", { exact: true })).toHaveValue("200");
  await expect(page.getByLabel("Phạm vi Intelligence")).toHaveValue(`daily:${eventId}`);
  expect(reads.filter((path) => path.endsWith("get_ops_intelligence_context_v1"))).toHaveLength(1);
  expect(reads.filter((path) => path.endsWith("get_ops_registration_pace_q0"))).toHaveLength(1);
  expect(reads.filter((path) => path.endsWith("get_ops_sepay_read_state_q0"))).toHaveLength(1);
  await page.getByRole("button", { name: "TỔNG QUAN", exact: true }).click();
  const settled = [...reads];
  await page.clock.runFor(65_000);
  expect(reads).toEqual(settled);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("Wave 2 festival hierarchy never sends festival IDs to Quant and displays missing truth", async ({ page }) => {
  const festivalId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const flightC = "20000000-0000-4000-8000-000000000003";
  const finalId = "20000000-0000-4000-8000-000000000004";
  const unknownId = "20000000-0000-4000-8000-000000000005";
  const base = contextFixture().dailyTournaments[0];
  let missing = false;
  const festivalContext = () => ({ ...contextFixture(), dailyTournaments: [], festivals: [{ festivalId, name: "Main Event", status: "scheduled", finalTournamentId: missing ? null : finalId, tournaments: [
    { ...base, name: "Flight A", phase: "flight", flightLabel: "A" },
    { ...base, tournamentId: secondEventId, name: "Flight B", phase: "flight", flightLabel: "B" },
    { ...base, tournamentId: flightC, name: "Flight C", phase: "flight", flightLabel: "C" },
    { ...base, tournamentId: finalId, name: "Final Day", phase: "final", flightLabel: null },
    ...(missing ? [{ ...base, tournamentId: unknownId, name: "Chưa phân vai", startTime: null, phase: null, flightLabel: null }] : []),
  ] }] });
  const prizeTargets: unknown[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", (request) => { if (request.url().includes("get_tournament_prize_pool")) prizeTargets.push(request.postDataJSON()); });
  await installMocks(page, { context: festivalContext, registration: () => missing ? {} : { ...registration(), events: [...registration().events, { ...registration().events[0], eventId: finalId, eventName: "Final Day" }] } });
  await page.clock.setFixedTime(new Date(asOf));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/ops/select-module");
  await expect(page.getByLabel("Phạm vi Intelligence")).toBeEnabled();
  await page.getByLabel("Phạm vi Intelligence").selectOption(`festival:${festivalId}`);
  await expect(page.getByTestId("overview-readiness").getByRole("button", { name: "Mở Quant", exact: true })).toHaveCount(0);
  await expect(page.getByText("Chọn Flight hoặc Final để mở Quant", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Lượt vào phạm vi chọn/ })).toContainText("UNAVAILABLE");
  await expect(page.getByTestId(`schedule-${secondEventId}`)).toContainText("Flight B");
  await expect(page.getByText("Final: Final Day", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "docs/ops/evidence/wave2/overview-festival-1440x900.png" });
  await page.getByRole("button", { name: "QUANT", exact: true }).click();
  await expect(page.getByTestId("forecast-final-summary")).toHaveCount(0);
  expect(prizeTargets).toEqual([]);
  await page.getByRole("button", { name: "TỔNG QUAN", exact: true }).click();
  await page.getByTestId(`schedule-${secondEventId}`).getByRole("button", { name: "Mở Quant" }).click();
  await expect(page.getByLabel("Phạm vi Intelligence")).toHaveValue(`flight:${festivalId}:${secondEventId}`);
  await expect.poll(() => prizeTargets.length).toBe(1);
  expect(JSON.stringify(prizeTargets)).toContain(secondEventId);
  expect(JSON.stringify(prizeTargets)).not.toContain(festivalId);
  await page.getByRole("button", { name: "TỔNG QUAN", exact: true }).click();
  await page.getByTestId(`schedule-${finalId}`).getByRole("button", { name: "Mở Quant" }).click();
  await expect(page.getByLabel("Phạm vi Intelligence")).toHaveValue(`final:${festivalId}:${finalId}`);
  await expect.poll(() => JSON.stringify(prizeTargets)).toContain(finalId);
  expect(JSON.stringify(prizeTargets)).not.toContain(festivalId);
  await page.getByRole("button", { name: "TỔNG QUAN", exact: true }).click();
  await expect(page.getByText("Main Event", { exact: true })).toBeVisible();
  missing = true;
  await page.getByRole("button", { name: "Đọc lại nguồn phạm vi", exact: true }).click();
  await page.getByRole("button", { name: "Làm mới", exact: true }).click();
  await expect(page.getByTestId(`schedule-${unknownId}`)).toContainText("VAI TRÒ CHƯA XÁC ĐỊNH");
  await expect(page.getByTestId(`schedule-${unknownId}`).getByRole("button", { name: "Mở Quant" })).toBeDisabled();
  await expect(page.getByText(/chưa có liên kết Final/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Lượt vào phạm vi chọn/ })).toContainText("UNAVAILABLE");
  expect(errors).toEqual([]);
});

test("Wave 2 exact empty Q0 still provides club observations and historical context", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await installMocks(page, { registration: () => ({ ...registration(), events: [] }) });
  await page.clock.setFixedTime(new Date(asOf));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/ops/select-module");
  await expect(page.getByText(/Không có giải trong khoảng vận hành hiện tại/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Người đang chơi/ })).toContainText("68");
  await expect(page.getByTestId(`schedule-${eventId}`)).toBeVisible();
  await expect(page.getByTestId("ops-quant-dashboard-q1")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Wave 2 context retry stays Overview and history offers no false remediation", async ({ page }) => {
  let valid = false;
  let contextReads = 0;
  await installMocks(page, { context: () => { contextReads++; return valid ? contextFixture() : {}; } });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/ops/select-module");
  const overview = page.getByTestId("ops-intelligence-overview-v1");
  const action = page.getByTestId("overview-action-context");
  await expect(action.getByRole("button", { name: "Đọc lại phạm vi" })).toBeVisible();
  await expect(action.getByRole("button", { name: "Mở Data Health" })).toHaveCount(0);
  const beforeAction = contextReads;
  await action.getByRole("button", { name: "Đọc lại phạm vi" }).click();
  await expect.poll(() => contextReads).toBeGreaterThan(beforeAction);
  await expect(overview).toBeVisible();
  await page.getByTestId("overview-readiness").getByRole("button", { name: /Phạm vi lịch/ }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Mở Data Health" })).toHaveCount(0);
  valid = true;
  const beforeSheet = contextReads;
  await page.getByRole("dialog").getByRole("button", { name: "Đọc lại phạm vi" }).click();
  await expect.poll(() => contextReads).toBeGreaterThan(beforeSheet);
  await expect(page.getByLabel("Phạm vi Intelligence")).toBeEnabled();
  await expect(overview).toBeVisible();
  await page.getByTestId("overview-readiness").getByRole("button", { name: /Series \/ lịch sử/ }).click();
  await expect(page.getByRole("dialog")).toContainText("HISTORY_NOT_MOUNTED");
  await expect(page.getByRole("dialog")).toContainText("Chưa được nối trong Wave 2");
  await expect(page.getByRole("dialog").getByRole("button", { name: "Mở Data Health" })).toHaveCount(0);
});

for (const source of [
  { id: "registration", path: "rpc/get_ops_registration_pace_q0", label: /Đăng ký/, target: "Mở Data Health", view: "ops-quant-data-health-q0" },
  { id: "sepay", path: "rpc/get_ops_sepay_read_state_q0", label: /^SePay/, target: "Mở Data Health", view: "ops-quant-data-health-q0" },
  { id: "operations", path: "game_tables", label: /Bàn & Dealer/, target: "Mở Live Ops", view: "ops-intelligence-command-center" },
]) {
  test(`Wave 2 ${source.id} remediation targets its owning view from action and source sheet`, async ({ page }) => {
    await installMocks(page);
    await page.route(`http://127.0.0.1:54321/rest/v1/${source.path}*`, (route) => route.fulfill({ status: source.id === "operations" ? 503 : 200, contentType: "application/json", body: source.id === "operations" ? JSON.stringify({ message: "Mock operations read unavailable" }) : "{}" }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/ops/select-module");
    await page.getByTestId(`overview-action-${source.id}`).getByRole("button", { name: source.target }).click();
    await expect(page.getByTestId(source.view)).toBeVisible();
    await page.getByRole("button", { name: "TỔNG QUAN", exact: true }).click();
    await page.getByTestId("overview-readiness").getByRole("button", { name: source.label }).click();
    await page.getByRole("dialog").getByRole("button", { name: source.target }).click();
    await expect(page.getByTestId(source.view)).toBeVisible();
  });
}

function pulse() {
  const metric = (metricId: string, sourceId: string, grain: string, definitionVersion: string, value: number) => ({ metricId, value, unit: "count", availability: "exact", privacyState: value > 0 && value < 5 ? "small_cohort_suppressed" : "safe", asOf, sourceId, grain, definitionVersion });
  return { version: "series-club-live-pulse-v1", clubId, asOf, clubLocalDate: "2026-08-29", timezone: "Asia/Ho_Chi_Minh", clubMemberProfiles: metric("club_member_profiles", "club_members", "club", "club-member-profiles-v1", 320), uniquePlayersToday: metric("unique_players_today", "tournaments.tournament_registrations.tournament_entries", "club_event_start_local_calendar_day", "club-unique-players-event-day-v1", 98), entriesToday: metric("entries_today", "tournaments.tournament_registrations", "club_event_start_local_calendar_day", "club-entries-event-day-v1", 123), playersPlayingNow: metric("players_playing_now", "tournament_seats.tournament_entries", "club_live_tournaments", "club-active-seated-players-v1", 68), runningEvents: metric("running_events", "tournaments", "club_live_tournaments", "club-running-events-v1", 1), openTables: metric("open_tables", "tournament_tables", "club_tournament_tables", "club-open-tables-v1", 8), dealersOnDuty: metric("dealers_on_duty", "dealer_attendance.dealers", "club_current_attendance", "club-dealers-on-duty-v1", 18), dataQuality: { unavailableMetricIds: [], partialMetricIds: [], staleMetricIds: [] } };
}

function registration() {
  const timeline = [12, 31, 49, 72, 91, 106, 116, 123].map((cumulativeCount, index, values) => ({ bucketStart: `2026-08-29T${String(index + 2).padStart(2, "0")}:00:00.000Z`, observedCount: cumulativeCount - (values[index - 1] ?? 0), cumulativeCount }));
  const event = (id: string, name: string, state: string, startTime: string, confirmedEntries: number) => ({ eventId: id, eventName: name, eventState: state, startTime, confirmedEntries, uniquePlayers: Math.max(0, confirmedEntries - 25), reentries: Math.min(25, confirmedEntries), firstRegistrationAt: confirmedEntries ? "2026-08-29T02:00:00.000Z" : null, lastRegistrationAt: confirmedEntries ? "2026-08-29T09:00:00.000Z" : null, last1h: Math.min(18, confirmedEntries), last6h: Math.min(62, confirmedEntries), last24h: confirmedEntries, timelineAvailability: "exact", timelineReasonCode: null, timeline: confirmedEntries ? timeline : [] });
  return { version: "ops-registration-observed-q0", clubId, asOf, window: { from: "2026-08-28T10:00:00.000Z", to: "2026-09-12T10:00:00.000Z" }, events: [event(eventId, "High Roller Day 1A", "registering", "2026-08-29T07:00:00.000Z", 123), event(secondEventId, "Deepstack Turbo", "completed", "2026-08-28T12:00:00.000Z", 0)] };
}

function sepay() {
  return { version: "ops-sepay-read-state-q0", clubId, asOf, window: { from: "2026-08-28T10:00:00.000Z", to: asOf }, latestObservedTransactionAt: "2026-08-29T09:59:00.000Z", buckets: [{ state: "actionable", transactionCount: 3, inboundAmountVnd: 6_000_000, amountAvailability: "exact", amountReasonCode: null }, { state: "resolved", transactionCount: 24, inboundAmountVnd: 48_000_000, amountAvailability: "exact", amountReasonCode: null }, { state: "quarantined", transactionCount: 0, inboundAmountVnd: 0, amountAvailability: "exact", amountReasonCode: null }] };
}

function seriesHistory() {
  const history = Array.from({ length: 12 }, (_, index) => ({ event_id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, event_name: index % 3 === 0 ? "High Roller" : "Main Event", event_date: `2025-${String(index + 1).padStart(2, "0")}-15T12:00:00.000Z`, buy_in: 2_000_000 + index * 100_000, fee: 300_000, service_fee: 0, gtd: 1_500_000_000 + index * 50_000_000, prize_pool_actual: 1_600_000_000 + index * 50_000_000, total_entries: 150 + index * 8, unique_entries: 130 + index * 7, reentries: 20 + index }));
  return [...history, { event_id: eventId, event_name: "High Roller Day 1A", event_date: "2026-08-29T07:00:00.000Z", buy_in: 2_000_000, fee: 300_000, service_fee: 0, gtd: 2_000_000_000, prize_pool_actual: null, total_entries: null, unique_entries: null, reentries: null }, { event_id: secondEventId, event_name: "Deepstack Turbo", event_date: "2026-08-28T12:00:00.000Z", buy_in: 1_500_000, fee: 250_000, service_fee: 0, gtd: 900_000_000, prize_pool_actual: null, total_entries: null, unique_entries: null, reentries: null }].map((row) => ({ ...row, club_id: clubId }));
}

function tables() {
  return Array.from({ length: 24 }, (_, index) => ({ id: `table-${index + 1}`, table_name: `T${String(index + 1).padStart(2, "0")}`, status: "active", current_blind_level: index < 8 ? 8 : null }));
}

function assignments() {
  return Array.from({ length: 7 }, (_, index) => ({ id: `assignment-${index + 1}`, attendance_id: `attendance-${index + 1}`, table_id: `table-${index + 1}`, assigned_at: "2026-08-29T06:00:00.000Z", released_at: null, status: "assigned", version: 1, updated_at: asOf, last_swing_attempted_at: null, swing_in_progress: false, swing_processed_at: null, swing_due_at: index === 6 ? "2026-08-29T08:00:00.000Z" : "2026-08-29T12:00:00.000Z", pre_assigned_attendance_id: null, pre_assigned_at: null, dealer_attendance: { current_state: "assigned", dealers: { full_name: `Dealer ${index + 1}` } } }));
}
