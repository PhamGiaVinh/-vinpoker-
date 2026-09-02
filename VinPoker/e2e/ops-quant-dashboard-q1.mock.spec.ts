import { expect, test, type Page } from "@playwright/test";

const clubId = "10000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000001";
const eventId = "20000000-0000-4000-8000-000000000001";
const secondEventId = "20000000-0000-4000-8000-000000000002";
const asOf = "2026-08-29T10:00:00.000Z";
const mockJwt = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJleHAiOjQxMDI0NDQ4MDAsInN1YiI6IjAwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMSJ9.";
const intelligenceReadPaths = new Set([
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
  await expect(page.getByTestId("ops-quant-dashboard-q1")).toBeVisible();
  await expect(page.getByText("VinPoker Quant Operations Terminal", { exact: true })).toBeVisible();
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
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (intelligenceReadPaths.has(path)) observedReads.push(path);
  });
  await installMocks(page);
  await page.setViewportSize({ width: 1194, height: 834 });
  await page.goto("/ops/select-module");
  await expect(page.getByRole("heading", { name: "Một lối vào cho mọi công việc vận hành" })).toBeVisible();
  await expect(page.getByTestId("ops-intelligence-workspace-q1")).toHaveCount(0);
  await expect.poll(() => observedReads).toEqual([]);
});

async function installMocks(page: Page) {
  await page.addInitScript(({ token, actor, createdAt }) => {
    localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: token, refresh_token: "mock", expires_in: 2_000_000_000, expires_at: 4_102_444_800, token_type: "bearer", user: { id: actor, aud: "authenticated", role: "authenticated", email: "owner@example.test", app_metadata: {}, user_metadata: {}, identities: [], created_at: createdAt } }));
  }, { token: mockJwt, actor: userId, createdAt: asOf });
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (path.endsWith("/auth/v1/user")) return json({ id: userId, aud: "authenticated", role: "authenticated", email: "owner@example.test", app_metadata: {}, user_metadata: {}, identities: [], created_at: asOf });
    if (path.endsWith("/rpc/get_my_ops_capability_scope")) return json([{ club_id: clubId, can_owner: true, can_floor: false, can_cashier: false, can_tracker: false, can_dealer_control: false, can_accountant: false, can_chip_master: false, can_marketer: false, can_fnb_cashier: false, can_fnb_server: false, can_fnb_kitchen: false }]);
    if (path.endsWith("/rpc/get_my_ops_global_capability")) return json([{ is_super_admin: false }]);
    if (path.endsWith("/clubs")) return json([{ id: clubId, name: "VinPoker Club" }]);
    if (path.endsWith("/rpc/get_series_club_live_pulse_v1")) return json(pulse());
    if (path.endsWith("/rpc/get_ops_registration_pace_q0")) return json(registration());
    if (path.endsWith("/rpc/get_ops_sepay_read_state_q0")) return json(sepay());
    if (path.endsWith("/rpc/get_club_series_events")) return json(seriesHistory());
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
