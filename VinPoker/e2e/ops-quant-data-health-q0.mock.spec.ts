import { expect, test, type Page } from "@playwright/test";

const clubId = "10000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000001";
const eventId = "20000000-0000-4000-8000-000000000001";
const asOf = "2026-08-29T10:00:00.000Z";
const mockJwt = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJleHAiOjQxMDI0NDQ4MDAsInN1YiI6IjAwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMSJ9.";

async function installMocks(page: Page) {
  await page.addInitScript(({ token, actor, createdAt }) => localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: token, refresh_token: "mock", expires_in: 2_000_000_000, expires_at: 4_102_444_800, token_type: "bearer", user: { id: actor, aud: "authenticated", role: "authenticated", email: "owner@example.test", app_metadata: {}, user_metadata: {}, identities: [], created_at: createdAt } })), { token: mockJwt, actor: userId, createdAt: asOf });
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (path.endsWith("/auth/v1/user")) return json({ id: userId, aud: "authenticated", role: "authenticated", email: "owner@example.test", app_metadata: {}, user_metadata: {}, identities: [], created_at: asOf });
    if (path.endsWith("/rpc/get_my_ops_capability_scope")) return json([{ club_id: clubId, can_owner: true, can_floor: false, can_cashier: false, can_tracker: false, can_dealer_control: false, can_accountant: false, can_chip_master: false, can_marketer: false, can_fnb_cashier: false, can_fnb_server: false, can_fnb_kitchen: false }]);
    if (path.endsWith("/rpc/get_my_ops_global_capability")) return json([{ is_super_admin: false }]);
    if (path.endsWith("/clubs")) return json([{ id: clubId, name: "HSOP TEST" }]);
    if (path.endsWith("/rpc/get_series_club_live_pulse_v1")) return json(pulse());
    if (path.endsWith("/rpc/get_ops_registration_pace_q0")) return json({ version: "ops-registration-observed-q0", clubId, asOf, window: { from: "2026-08-28T10:00:00.000Z", to: "2026-09-12T10:00:00.000Z" }, events: [{ eventId, eventName: "Main Event", eventState: "scheduled", startTime: "2026-08-30T10:00:00.000Z", confirmedEntries: 2, uniquePlayers: 1, reentries: 1, firstRegistrationAt: "2026-08-29T09:00:00.000Z", lastRegistrationAt: "2026-08-29T09:30:00.000Z", last1h: 2, last6h: 2, last24h: 2, timelineAvailability: "exact", timelineReasonCode: null, timeline: [{ bucketStart: "2026-08-29T09:00:00.000Z", observedCount: 2, cumulativeCount: 2 }] }] });
    if (path.endsWith("/rpc/get_ops_sepay_read_state_q0")) return json({ version: "ops-sepay-read-state-q0", clubId, asOf, window: { from: "2026-08-28T10:00:00.000Z", to: asOf }, latestObservedTransactionAt: "2026-08-29T09:30:00.000Z", buckets: [{ state: "actionable", transactionCount: 0, inboundAmountVnd: 0, amountAvailability: "exact", amountReasonCode: null }, { state: "resolved", transactionCount: 2, inboundAmountVnd: 4_000_000, amountAvailability: "exact", amountReasonCode: null }, { state: "quarantined", transactionCount: 0, inboundAmountVnd: 0, amountAvailability: "exact", amountReasonCode: null }] });
    if (path.endsWith("/rpc/get_club_series_events")) return json([]);
    if (path.endsWith("/rpc/get_tournament_prize_pool")) return json([{ prize_pool: 0, confirmed_entry_count: 0 }]);
    if (path.endsWith("/rpc/get_club_finance_summary")) return json({ revenue: { total: 0, rake: 0, serviceFee: 0, stakingFees: 0, payoutFees: 0, fnb: 0 }, cost: { payrollNet: 0, ptWagePaid: 0, fnbCogs: 0, compCogs: 0, clubExpenses: 0 }, net: 0 });
    if (path.endsWith("/rpc/get_latest_owner_daily_digest_artifact")) return json(null);
    if (path.endsWith("/game_tables")) return json(Array.from({ length: 101 }, (_, index) => ({ id: `table-${index + 1}`, table_name: `Bàn ${index + 1}`, status: "active", current_blind_level: 4 })));
    if (path.endsWith("/tournaments")) return json([{ id: eventId, name: "Main Event", status: "live", current_level: 4, average_stack: 42_000, tournament_tables: Array.from({ length: 4 }, (_, index) => ({ table_id: `table-${index + 1}`, status: "active" })) }]);
    if (path.endsWith("/dealer_assignments") || path.endsWith("/dealer_attendance")) return json([]);
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
}

test("Q0 shows observed registration, sanitized SePay, capacity truth and explicit event blocker", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await installMocks(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/ops/select-module");
  await page.getByRole("button", { name: "DATA HEALTH" }).click();
  await expect(page.getByTestId("ops-quant-data-health-q0")).toBeVisible();
  await expect(page.getByText("Nhịp đăng ký quan sát", { exact: true })).toBeVisible();
  await expect(page.getByText("SePay read state", { exact: true })).toBeVisible();
  await expect(page.getByText(/EVENT_SOURCE_NOT_APPROVED/)).toHaveCount(2);
  await expect(page.getByText("4.000.000 ₫", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const viewport of [{ width: 1194, height: 834 }, { width: 834, height: 1112 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("heading", { name: "Một lối vào cho mọi công việc vận hành" })).toBeVisible();
    await expect(page.getByTestId("ops-quant-data-health-q0")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

function pulse() {
  const metric = (metricId: string, sourceId: string, grain: string, definitionVersion: string, value: number) => ({ metricId, value, unit: "count", availability: "exact", privacyState: value > 0 && value < 5 ? "small_cohort_suppressed" : "safe", asOf, sourceId, grain, definitionVersion });
  return { version: "series-club-live-pulse-v1", clubId, asOf, clubLocalDate: "2026-08-29", timezone: "Asia/Ho_Chi_Minh", clubMemberProfiles: metric("club_member_profiles", "club_members", "club", "club-member-profiles-v1", 10), uniquePlayersToday: metric("unique_players_today", "tournaments.tournament_registrations.tournament_entries", "club_event_start_local_calendar_day", "club-unique-players-event-day-v1", 1), entriesToday: metric("entries_today", "tournaments.tournament_registrations", "club_event_start_local_calendar_day", "club-entries-event-day-v1", 2), playersPlayingNow: metric("players_playing_now", "tournament_seats.tournament_entries", "club_live_tournaments", "club-active-seated-players-v1", 1), runningEvents: metric("running_events", "tournaments", "club_live_tournaments", "club-running-events-v1", 1), openTables: metric("open_tables", "tournament_tables", "club_tournament_tables", "club-open-tables-v1", 4), dealersOnDuty: metric("dealers_on_duty", "dealer_attendance.dealers", "club_current_attendance", "club-dealers-on-duty-v1", 0), dataQuality: { unavailableMetricIds: [], partialMetricIds: [], staleMetricIds: [] } };
}
