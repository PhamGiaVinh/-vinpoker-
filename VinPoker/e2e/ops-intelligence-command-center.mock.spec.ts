import { expect, test, type Page } from "@playwright/test";

const clubId = "10000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000001";
const futureExpiry = 4_102_444_800;
const mockJwt = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJleHAiOjQxMDI0NDQ4MDAsInN1YiI6IjAwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMSJ9.";
const asOf = "2026-08-27T01:02:03.000Z";

const ownerScope = [{ club_id: clubId, can_owner: true, can_floor: false, can_cashier: false, can_tracker: false, can_dealer_control: false, can_accountant: false, can_chip_master: false, can_marketer: false, can_fnb_cashier: false, can_fnb_server: false, can_fnb_kitchen: false }];

function pulseMetric(metricId: string, sourceId: string, grain: string, definitionVersion: string, value: number) {
  return { metricId, value, unit: "count", availability: "exact", privacyState: value > 0 && value < 5 ? "small_cohort_suppressed" : "safe", asOf, sourceId, grain, definitionVersion };
}

function clubPulse() {
  return {
    version: "series-club-live-pulse-v1", clubId, asOf, clubLocalDate: "2026-08-27", timezone: "Asia/Ho_Chi_Minh",
    clubMemberProfiles: pulseMetric("club_member_profiles", "club_members", "club", "club-member-profiles-v1", 10),
    uniquePlayersToday: pulseMetric("unique_players_today", "tournaments.tournament_registrations.tournament_entries", "club_event_start_local_calendar_day", "club-unique-players-event-day-v1", 5),
    entriesToday: pulseMetric("entries_today", "tournaments.tournament_registrations", "club_event_start_local_calendar_day", "club-entries-event-day-v1", 8),
    playersPlayingNow: pulseMetric("players_playing_now", "tournament_seats.tournament_entries", "club_live_tournaments", "club-active-seated-players-v1", 5),
    runningEvents: pulseMetric("running_events", "tournaments", "club_live_tournaments", "club-running-events-v1", 5),
    openTables: pulseMetric("open_tables", "tournament_tables", "club_tournament_tables", "club-open-tables-v1", 2),
    dealersOnDuty: pulseMetric("dealers_on_duty", "dealer_attendance.dealers", "club_current_attendance", "club-dealers-on-duty-v1", 5),
    dataQuality: { unavailableMetricIds: [], partialMetricIds: [], staleMetricIds: [] },
  };
}

async function installMockOpsSession(page: Page) {
  await page.addInitScript(({ token, expiry, actor }) => {
    localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: token, refresh_token: "mock-refresh-token", expires_in: expiry - Math.floor(Date.now() / 1000), expires_at: expiry, token_type: "bearer", user: { id: actor, aud: "authenticated", role: "authenticated", email: "owner@example.test", app_metadata: {}, user_metadata: {}, identities: [], created_at: "2026-08-09T00:00:00.000Z" } }));
  }, { token: mockJwt, expiry: futureExpiry, actor: userId });
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (path.endsWith("/rpc/get_my_ops_capability_scope")) return json(ownerScope);
    if (path.endsWith("/rpc/get_my_ops_global_capability")) return json([{ is_super_admin: false }]);
    if (path.endsWith("/clubs")) return json([{ id: clubId, name: "HSOP TEST" }]);
    if (path.endsWith("/rpc/get_series_club_live_pulse_v1")) return json(clubPulse());
    if (path.endsWith("/rpc/get_club_finance_summary")) return json({ revenue: { total: 12500000, rake: 0, serviceFee: 0, stakingFees: 0, payoutFees: 0, fnb: 0 }, cost: { payrollNet: 0, ptWagePaid: 0, fnbCogs: 0, compCogs: 0, clubExpenses: 0 }, net: 12500000 });
    if (path.endsWith("/rpc/get_latest_owner_daily_digest_artifact")) return json(null);
    if (path.endsWith("/game_tables")) return json([{ id: "table-1", table_name: "Bàn 1", status: "active", current_blind_level: 4 }, { id: "table-2", table_name: "Bàn 2", status: "active", current_blind_level: 4 }]);
    if (path.endsWith("/tournaments")) return json([{ id: "event-1", name: "Main Event", status: "live", current_level: 4, average_stack: 42000, tournament_tables: [{ table_id: "table-1" }, { table_id: "table-2" }] }]);
    if (path.endsWith("/dealer_assignments")) return json([{ id: "assignment-1", attendance_id: "attendance-1", table_id: "table-1", assigned_at: asOf, released_at: null, status: "assigned", version: 1, updated_at: asOf, last_swing_attempted_at: null, swing_in_progress: false, swing_processed_at: null, swing_due_at: "2026-08-27T03:00:00.000Z", pre_assigned_attendance_id: null, pre_assigned_at: null, dealer_attendance: { current_state: "assigned", dealers: { full_name: "Dealer A" } } }]);
    if (path.endsWith("/dealer_attendance")) return json([{ id: "attendance-1", dealer_id: "dealer-1", check_in_time: asOf }]);
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
}

test("desktop owner terminal respects source provenance and responsive fallback", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await installMockOpsSession(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/ops/select-module");
  await expect(page.getByTestId("ops-intelligence-command-center")).toBeVisible();
  await expect(page.getByText("Ops Intelligence Command Center", { exact: true })).toBeVisible();
  await expect(page.getByText("LIVE", { exact: true })).toBeVisible();
  await expect(page.getByText("8", { exact: true })).toBeVisible();
  await expect(page.getByText("Chưa phân công", { exact: true })).toBeVisible();
  await expect(page.getByText("TRACKER_ALERT_ROLLOUT_DISABLED", { exact: true })).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("ops-intelligence-command-center-desktop.png"), fullPage: true });
  for (const viewport of [{ width: 1194, height: 834 }, { width: 834, height: 1112 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("heading", { name: "Một lối vào cho mọi công việc vận hành" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/ops/select-module?view=spaces");
  await expect(page.getByRole("heading", { name: "Chọn không gian làm việc" })).toBeVisible();
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("ops-intelligence-command-center-selector.png"), fullPage: true });
});
