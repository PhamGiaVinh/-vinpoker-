import { expect, test, type Page, type Route } from "@playwright/test";

const API_ORIGIN = "http://127.0.0.1:54329";
const CLUB_ID = "22222222-2222-2222-2222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const DEALER_ONE = "33333333-3333-4333-8333-333333333331";
const DEALER_TWO = "33333333-3333-4333-8333-333333333332";
const DEALER_SCHEDULED = "33333333-3333-4333-8333-333333333333";
const DEALER_UNSCHEDULED = "33333333-3333-4333-8333-333333333334";
const ATTENDANCE_ONE = "44444444-4444-4444-8444-444444444441";
const ATTENDANCE_TWO = "44444444-4444-4444-8444-444444444442";
const TABLE_ONE = "55555555-5555-4555-8555-555555555551";
const TABLE_TWO = "55555555-5555-4555-8555-555555555552";
const ASSIGNMENT_ONE = "66666666-6666-4666-8666-666666666661";
const ASSIGNMENT_TWO = "66666666-6666-4666-8666-666666666662";
const SCHEDULE_RUN = "77777777-7777-4777-8777-777777777771";
const SHIFT_ASSIGNMENT = "88888888-8888-4888-8888-888888888881";
const massOpenTables = Array.from({ length: 28 }, (_, index) => {
  const tableNumber = index + 3;
  const suffix = String(tableNumber).padStart(12, "0");
  return {
    id: `55555555-5555-4555-8555-${suffix}`,
    club_id: CLUB_ID,
    table_name: `Table ${String(tableNumber).padStart(2, "0")}`,
    table_type: "tournament",
    status: "inactive",
    shift_id: null,
  };
});

const jsonHeaders = {
  "access-control-allow-origin": "*",
  "content-type": "application/json; charset=utf-8",
};

function todayInClub(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function isoAt(hour: number, minute = 0): string {
  return `${todayInClub()}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+07:00`;
}

function encodeJwtPart(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function localSession() {
  const expiresAt = Math.floor(Date.now() / 1_000) + 3_600;
  const confirmedAt = new Date(Date.now() - 60_000).toISOString();
  const accessToken = [
    encodeJwtPart({ alg: "none", typ: "JWT" }),
    encodeJwtPart({ sub: USER_ID, role: "authenticated", aud: "authenticated", exp: expiresAt }),
    "local-signature",
  ].join(".");
  const user = {
    id: USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: "dealer-phone-uat@local.invalid",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: new Date().toISOString(),
    confirmed_at: confirmedAt,
    email_confirmed_at: confirmedAt,
    last_sign_in_at: confirmedAt,
  };
  return {
    access_token: accessToken,
    refresh_token: "local-refresh-token",
    expires_at: expiresAt,
    expires_in: 3_600,
    token_type: "bearer",
    user,
  };
}

const dealers = [
  { id: DEALER_ONE, club_id: CLUB_ID, full_name: "An Nguyen", tier: "A", status: "active", skills: [], shift_preference: null, deleted_at: null },
  { id: DEALER_TWO, club_id: CLUB_ID, full_name: "Binh Tran", tier: "A", status: "active", skills: [], shift_preference: null, deleted_at: null },
  { id: DEALER_SCHEDULED, club_id: CLUB_ID, full_name: "Chi Le", tier: "B", status: "active", skills: [], shift_preference: null, deleted_at: null },
  { id: DEALER_UNSCHEDULED, club_id: CLUB_ID, full_name: "Dung Pham", tier: "B", status: "active", skills: [], shift_preference: null, deleted_at: null },
];

const gameTables = [
  { id: TABLE_ONE, club_id: CLUB_ID, table_name: "Table 01", table_type: "tournament", status: "active", shift_id: null },
  { id: TABLE_TWO, club_id: CLUB_ID, table_name: "Table 02", table_type: "tournament", status: "active", shift_id: null },
];

function attendanceRows() {
  return [
    {
      id: ATTENDANCE_ONE,
      dealer_id: DEALER_ONE,
      shift_date: todayInClub(),
      status: "checked_in",
      check_in_time: isoAt(9),
      check_out_time: null,
      overtime_minutes: 0,
      current_state: "assigned",
      worked_minutes_since_last_break: 30,
      priority_break_flag: false,
      last_released_at: null,
      dealers: { full_name: "An Nguyen", telegram_username: null, tier: "A", club_id: CLUB_ID },
    },
    {
      id: ATTENDANCE_TWO,
      dealer_id: DEALER_TWO,
      shift_date: todayInClub(),
      status: "checked_in",
      check_in_time: isoAt(9, 5),
      check_out_time: null,
      overtime_minutes: 0,
      current_state: "assigned",
      worked_minutes_since_last_break: 25,
      priority_break_flag: false,
      last_released_at: null,
      dealers: { full_name: "Binh Tran", telegram_username: null, tier: "A", club_id: CLUB_ID },
    },
  ];
}

function activeAssignments() {
  return [
    {
      id: ASSIGNMENT_ONE,
      attendance_id: ATTENDANCE_ONE,
      table_id: TABLE_ONE,
      assigned_at: isoAt(9, 10),
      released_at: null,
      status: "assigned",
      version: 4,
      swing_due_at: isoAt(23),
      planned_relief_at: null,
      pre_assigned_attendance_id: null,
      pre_assigned_at: null,
      game_tables: gameTables[0],
      dealer_attendance: { current_state: "assigned", dealers: { full_name: "An Nguyen", telegram_username: null } },
      pre_assigned: null,
    },
    {
      id: ASSIGNMENT_TWO,
      attendance_id: ATTENDANCE_TWO,
      table_id: TABLE_TWO,
      assigned_at: isoAt(9, 12),
      released_at: null,
      status: "assigned",
      version: 7,
      swing_due_at: isoAt(23),
      planned_relief_at: null,
      pre_assigned_attendance_id: null,
      pre_assigned_at: null,
      game_tables: gameTables[1],
      dealer_attendance: { current_state: "assigned", dealers: { full_name: "Binh Tran", telegram_username: null } },
      pre_assigned: null,
    },
  ];
}

async function fulfill(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, headers: jsonHeaders, body: JSON.stringify(body) });
}

async function installFixtureRoutes(page: Page) {
  await page.route(`${API_ORIGIN}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: jsonHeaders });
      return;
    }
    if (path === "/auth/v1/user") {
      await fulfill(route, localSession().user);
      return;
    }
    if (path.startsWith("/realtime/v1")) {
      await fulfill(route, {});
      return;
    }
    if (path.startsWith("/functions/v1/telegram-swing-notifier")) {
      await fulfill(route, { ok: true, duplicate: false });
      return;
    }
    if (path.startsWith("/functions/v1/mass-assign")) {
      await fulfill(route, {
        requested: 30,
        assigned: 25,
        remaining: 5,
        assigned_this_run: 6,
        operation_status: "waiting_for_dealer",
        outcomes: [],
      });
      return;
    }

    const rpcName = path.startsWith("/rest/v1/rpc/") ? path.split("/").at(-1) : null;
    if (rpcName) {
      const payload = request.postDataJSON() as Record<string, unknown> | null;
      if (rpcName === "get_my_floor_operator_scope") {
        await fulfill(route, [{ club_id: CLUB_ID, can_owner: true, can_cashier: true, can_floor: true }]);
        return;
      }
      if (rpcName === "dealer_control_club_ids") {
        await fulfill(route, [CLUB_ID]);
        return;
      }
      if (rpcName === "get_dealer_swing_phone_rollout") {
        await fulfill(route, { master_enabled: true, allowlisted: true, all_clubs_enabled: false });
        return;
      }
      if (rpcName === "get_dealer_mass_open_rollout") {
        await fulfill(route, { allowed: true, enabled: true, all_clubs_enabled: false });
        return;
      }
      if (rpcName === "operator_open_dealer_tables") {
        await fulfill(route, {
          outcome: "waiting_for_dealer",
          operation_status: "waiting_for_dealer",
          operation_id: payload?.p_request_id,
          requested: 30,
          assigned: 19,
          remaining: 11,
        });
        return;
      }
      if (rpcName === "get_dealer_open_operation") {
        await fulfill(route, {
          outcome: "waiting_for_dealer",
          operation_status: "waiting_for_dealer",
          operation_id: payload?.p_operation_id,
          requested: 30,
          assigned: 25,
          remaining: 5,
        });
        return;
      }
      if (rpcName === "get_dealer_availability_requests") {
        await fulfill(route, []);
        return;
      }
      if (rpcName === "operator_check_in_dealers") {
        const entries = (payload?.p_entries ?? []) as Array<{ entry_id: string; dealer_id?: string | null }>;
        await fulfill(route, {
          outcome: "completed",
          request_id: payload?.p_request_id,
          club_id: CLUB_ID,
          results: entries.map((entry, index) => ({
            entry_id: entry.entry_id,
            dealer_id: entry.dealer_id ?? (index === 0 ? DEALER_SCHEDULED : DEALER_UNSCHEDULED),
            code: index === 0 ? "checked_in_waiting" : "checked_in_available",
            arrival_at: new Date().toISOString(),
            payroll_start_at: index === 0 ? null : new Date().toISOString(),
          })),
        });
        return;
      }
      if (rpcName === "close_dealer_tables") {
        if (payload?.p_dry_run === true) {
          await fulfill(route, {
            outcome: "dry_run",
            operation_id: payload.p_request_id,
            state_hash: "fixture-state-hash",
            tables: [{ table_id: TABLE_ONE, table_name: "Table 01", state_hash: "fixture-table-hash" }],
          });
        } else {
          await fulfill(route, {
            outcome: "conflict",
            operation_id: payload?.p_request_id,
            results: [{ table_id: TABLE_ONE, code: "conflict" }],
          });
        }
        return;
      }
      if (rpcName === "dealer_phone_reconcile_room_state") {
        if (payload?.p_dry_run === true) {
          await fulfill(route, {
            outcome: "dry_run",
            can_apply: true,
            plan: [
              { table_id: TABLE_ONE, expected_assignment_id: ASSIGNMENT_ONE, expected_version: 4 },
              { table_id: TABLE_TWO, expected_assignment_id: ASSIGNMENT_TWO, expected_version: 7 },
            ],
          });
        } else {
          await fulfill(route, { outcome: "race_lost", can_apply: false });
        }
        return;
      }
      await fulfill(route, []);
      return;
    }

    if (!path.startsWith("/rest/v1/")) {
      await fulfill(route, {});
      return;
    }

    const table = path.split("/").at(-1);
    if (table === "user_roles") {
      await fulfill(route, [{ role: "super_admin" }]);
      return;
    }
    if (table === "clubs") {
      await fulfill(route, [{ id: CLUB_ID, name: "HSOP", owner_id: USER_ID }]);
      return;
    }
    if (table === "dealers") {
      if (url.searchParams.get("user_id") === `eq.${USER_ID}`) {
        await fulfill(route, []);
      } else {
        await fulfill(route, dealers);
      }
      return;
    }
    if (table === "dealer_attendance") {
      const status = url.searchParams.get("status");
      if (status === "eq.checked_out") {
        await fulfill(route, []);
      } else {
        await fulfill(route, attendanceRows());
      }
      return;
    }
    if (table === "dealer_assignments") {
      await fulfill(route, activeAssignments());
      return;
    }
    if (table === "game_tables") {
      await fulfill(route, [...gameTables, ...massOpenTables]);
      return;
    }
    if (table === "dealer_schedule_runs") {
      await fulfill(route, [{ id: SCHEDULE_RUN, work_date: todayInClub(), published_at: new Date().toISOString() }]);
      return;
    }
    if (table === "dealer_shift_assignments") {
      await fulfill(route, [{
        id: SHIFT_ASSIGNMENT,
        run_id: SCHEDULE_RUN,
        club_id: CLUB_ID,
        dealer_id: DEALER_SCHEDULED,
        work_date: todayInClub(),
        scheduled_start_at: isoAt(18),
        scheduled_end_at: isoAt(23),
        status: "confirmed",
        checked_in_at: null,
      }]);
      return;
    }
    if (table === "dealer_shift_events" || table === "dealer_skills" || table === "dealer_shift_templates" || table === "dealer_availability_requests") {
      await fulfill(route, []);
      return;
    }
    if (request.method() === "PATCH") {
      await route.fulfill({ status: 204, headers: jsonHeaders });
      return;
    }
    await fulfill(route, []);
  });
}

async function assertFitsViewport(page: Page) {
  const fits = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(fits.documentWidth).toBeLessThanOrEqual(fits.viewportWidth + 1);
}

test.beforeEach(async ({ page }) => {
  await installFixtureRoutes(page);
  await page.addInitScript((session) => {
    localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
  }, localSession());
});

test("phone completion handles camera fallback, manual batch, close conflict, and reconcile race", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ops/dealer-swing");
  await expect(page.getByRole("heading", { name: "Dealer Swing" })).toBeVisible();
  await expect(page.getByText(/^HSOP ·/)).toBeVisible();
  await assertFitsViewport(page);

  await page.getByRole("button", { name: /Nhân sự/ }).click();
  const completionGateError = page.getByRole("alert");
  const checkinButton = page.getByRole("button", { name: /Check-in dealer mới/ });
  await expect.poll(async () => (
    await completionGateError.count() + await checkinButton.count()
  )).toBeGreaterThan(0);
  await expect(completionGateError).toHaveCount(0);
  await checkinButton.click();
  await expect(page.getByRole("heading", { name: "Check-in dealer" })).toBeVisible();
  await expect(page.getByText(/Không mở được camera/)).toBeVisible();
  await page.getByRole("tab", { name: "Danh sách" }).click();
  await page.getByRole("button", { name: /Chi Le/ }).click();
  await page.getByRole("button", { name: /Dung Pham/ }).click();
  await page.getByPlaceholder("Lý do riêng cho Dung Pham").fill("Dealer thay ca khẩn cấp");
  await page.getByRole("button", { name: "Check-in 2 dealer" }).click();
  await expect(page.getByText("Đã xử lý toàn bộ dealer")).toBeVisible();
  await expect(page.getByText("Đã ghi nhận đến, đang chờ giờ vào ca")).toBeVisible();
  await expect(page.getByText("Đã check-in và vào pool")).toBeVisible();
  await assertFitsViewport(page);
  await page.getByRole("button", { name: "Đóng", exact: true }).click();

  await page.getByRole("button", { name: "Lịch", exact: true }).click();
  await page.getByRole("button", { name: "Đóng bàn", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Đóng bàn" })).toBeVisible();
  await page.getByRole("button", { name: /Table 01/ }).click();
  await page.getByRole("button", { name: "Kiểm tra 1 bàn" }).click();
  await expect(page.getByText("Xác nhận đóng 1 bàn")).toBeVisible();
  await page.getByRole("button", { name: "Đóng bàn", exact: true }).click();
  await expect(page.getByText(/Không bàn nào bị đóng/)).toBeVisible();
  await assertFitsViewport(page);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Sửa sơ đồ", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sửa sơ đồ dealer" })).toBeVisible();
  const selects = page.getByRole("combobox");
  await selects.nth(0).click();
  await page.getByRole("option", { name: /Binh Tran/ }).click();
  await selects.nth(1).click();
  await page.getByRole("option", { name: /An Nguyen/ }).click();
  await page.getByRole("button", { name: "Kiểm tra", exact: true }).click();
  await expect(page.getByText(/Server đã kiểm tra 2 bàn/)).toBeVisible();
  await page.getByRole("button", { name: "Áp dụng" }).click();
  await expect(page.getByText(/Sơ đồ vừa thay đổi/)).toBeVisible();
  await expect(page.getByText(/Đã sửa sơ đồ/)).toHaveCount(0);
  await assertFitsViewport(page);

  await page.screenshot({
    path: testInfo.outputPath(`dealer-swing-phone-${testInfo.project.name}.png`),
    fullPage: true,
  });
});

test("desktop mass-open reports durable progress and leaves the remainder to cron", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dealer-swing");
  await expect(page.getByText("DEALER SWING", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Thêm bàn/ }).click();
  await expect(page.getByRole("heading", { name: "Thêm bàn từ pool" })).toBeVisible();

  await page.getByRole("button", { name: "Chọn tất cả" }).click();
  await expect(page.getByRole("button", { name: "Mở 30 bàn" })).toBeEnabled();
  await page.getByRole("button", { name: "Mở 30 bàn" }).click();

  await expect(page.getByText("Đã có dealer 25/30 bàn", { exact: true })).toBeVisible();
  await expect(page.getByText("Còn 5")).toBeVisible();
  await expect(page.getByText(/Cron sẽ tiếp tục tự gán/)).toBeVisible();
  await assertFitsViewport(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.screenshot({
    path: testInfo.outputPath("dealer-swing-mass-open-desktop.png"),
  });
});
