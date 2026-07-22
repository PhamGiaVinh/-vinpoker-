import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import {
  classifyShortage,
  decideShortageAlert,
  dedupeActiveAttendance,
  formatShortageTelegram,
  sanitizeShortageSnapshot,
  shortageSeverity,
  type CanonicalShortageSnapshot,
} from "./shortageAlert.ts";

function snapshot(overrides: Partial<CanonicalShortageSnapshot> = {}): CanonicalShortageSnapshot {
  return {
    status: "ok",
    error_code: null,
    captured_at: "2026-07-21T00:00:00.000Z",
    active_staffed_tables: 19,
    active_empty_tables: 0,
    tables_due_for_relief: 19,
    tables_overdue_for_relief: 0,
    tables_without_replacement_total: 0,
    replacement_held_tables: 0,
    checked_in_active_dealers: 90,
    genuinely_available_dealers: 50,
    eligible_for_any_uncovered_table_total: 50,
    on_break_not_ready_dealers: 0,
    on_break_ready_dealers: 0,
    pre_assigned_dealers: 0,
    reserved_dealers: 0,
    active_meal_break_dealers: 0,
    feature_reserved_dealers: 0,
    pending_durable_mass_open_targets: 0,
    excluded_dealers: { busy: 0, fatigue: 0, rest: 0, game_type: 0, tier: 0, meal_break: 0 },
    ...overrides,
  };
}

Deno.test("query and dependency snapshot failures are fail-closed before Telegram eligibility", () => {
  for (const status of ["query_failed", "dependency_unavailable"] as const) {
    const decision = decideShortageAlert(snapshot({ status, error_code: `shortage_snapshot_tables_${status}` }), {
      row: { shortage_notify_telegram: true },
      error: null,
    });
    assertEquals(decision.classification, "snapshot_invalid");
    assertEquals(decision.notifyEnabled, false);
    assertEquals(decision.failure?.status, status);
  }
});

Deno.test("notification setting false or a setting query failure never enables Telegram", () => {
  const shortage = snapshot({
    tables_without_replacement_total: 2,
    eligible_for_any_uncovered_table_total: 0,
    genuinely_available_dealers: 0,
  });
  assertEquals(
    decideShortageAlert(shortage, { row: { shortage_notify_telegram: false }, error: null }),
    { classification: "true_shortage", notifyEnabled: false, failure: null },
  );
  const failedSetting = decideShortageAlert(shortage, {
    row: null,
    error: { code: "XX000", message: "connection reset" },
  });
  assertEquals(failedSetting.notifyEnabled, false);
  assertEquals(failedSetting.failure?.status, "query_failed");
  assertEquals(failedSetting.failure?.stage, "notification_setting");
});

Deno.test("available dealers and held replacements do not produce a false shortage", () => {
  assertEquals(
    classifyShortage(snapshot({ tables_without_replacement_total: 19, eligible_for_any_uncovered_table_total: 50 })),
    "healthy",
  );
  assertEquals(
    classifyShortage(snapshot({
      tables_without_replacement_total: 0,
      replacement_held_tables: 19,
      pre_assigned_dealers: 19,
      reserved_dealers: 19,
      eligible_for_any_uncovered_table_total: 0,
    })),
    "reserved_relief_pending",
  );
});

Deno.test("meal-break dealers are not counted as available and a real shortage is classified", () => {
  const mealBreakOnly = snapshot({
    tables_without_replacement_total: 2,
    eligible_for_any_uncovered_table_total: 0,
    genuinely_available_dealers: 0,
    active_meal_break_dealers: 1,
    on_break_ready_dealers: 0,
    excluded_dealers: { busy: 0, fatigue: 0, rest: 0, game_type: 0, tier: 0, meal_break: 1 },
  });
  assertEquals(classifyShortage(mealBreakOnly), "true_shortage");
  assertEquals(shortageSeverity(classifyShortage(mealBreakOnly)), 1);
});

Deno.test("checked-out attendance is ignored and duplicate checked-in attendance is deduplicated", () => {
  const rows = dedupeActiveAttendance([
    {
      id: "attendance-old",
      dealer_id: "dealer-a",
      current_state: "available",
      status: "checked_in",
      check_out_time: null,
      check_in_time: "2026-07-21T08:00:00.000Z",
      last_released_at: null,
    },
    {
      id: "attendance-new",
      dealer_id: "dealer-a",
      current_state: "available",
      status: "checked_in",
      check_out_time: null,
      check_in_time: "2026-07-21T09:00:00.000Z",
      last_released_at: null,
    },
    {
      id: "attendance-checked-out",
      dealer_id: "dealer-b",
      current_state: "available",
      status: "checked_in",
      check_out_time: "2026-07-21T09:00:00.000Z",
      check_in_time: "2026-07-21T08:00:00.000Z",
      last_released_at: null,
    },
  ]);
  assertEquals(rows.map((row) => row.id), ["attendance-new"]);
});

Deno.test("Telegram wording is evidence-based and the persisted snapshot is bounded and sanitized", () => {
  const critical = snapshot({
    tables_without_replacement_total: 3,
    tables_overdue_for_relief: 3,
    eligible_for_any_uncovered_table_total: 0,
    genuinely_available_dealers: 0,
    error_code: `raw error ${"x".repeat(9_000)}`,
  });
  assertEquals(classifyShortage(critical), "critical_shortage");
  const message = formatShortageTelegram("critical_shortage", critical);
  assertMatch(message ?? "", /Ban can nguoi thay: 3/);
  assertEquals((message ?? "").toLowerCase().includes("pool"), false);
  const sanitized = sanitizeShortageSnapshot(critical);
  assertEquals(sanitized.error_code, null);
  assertEquals(new TextEncoder().encode(JSON.stringify(sanitized)).byteLength <= 8_000, true);
});
