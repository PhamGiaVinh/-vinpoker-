import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  assessAllTablesOtAlert,
  assessAvailableDealerCount,
  assessCoreQueryFailure,
  assessDealerInventory,
  assessLockOwnershipLoss,
  assessShortageNotifySetting,
  ensureLockOwnership,
  LockOwnershipLost,
} from "./executionSafety.ts";

const CLUB_ID = "22222222-2222-2222-2222-222222222222";

Deno.test("a reclaimed lease aborts remaining passes without a completed dispatch outcome", async () => {
  const passes: string[] = [];
  await assertRejects(
    async () => {
      await ensureLockOwnership(
        { rpc: async () => ({ data: false, error: null }) },
        CLUB_ID,
        "lease-token",
        120,
      );
      passes.push("mutation_after_lease_check");
    },
    LockOwnershipLost,
  );
  assertEquals(passes, []);
  assertEquals(
    assessLockOwnershipLoss(new LockOwnershipLost(CLUB_ID, "lease_reclaimed")),
    {
      dispatchState: "locked",
      dispatchErrorCode: "club_lock_ownership_lost",
      diagnostic: { stage: "club_lock_ownership", code: "LEASE_RECLAIMED" },
    },
  );
});

Deno.test("a failed lease ownership RPC check fails closed before later mutations", async () => {
  const passes: string[] = [];
  await assertRejects(
    async () => {
      await ensureLockOwnership(
        { rpc: async () => ({ data: null, error: { code: "XX000" } }) },
        CLUB_ID,
        "lease-token",
        120,
      );
      passes.push("mutation_after_lease_check");
    },
    LockOwnershipLost,
  );
  assertEquals(passes, []);
  assertEquals(
    assessLockOwnershipLoss(new LockOwnershipLost(CLUB_ID, "lease_check_failed")),
    {
      dispatchState: "business_failed",
      dispatchErrorCode: "club_lock_ownership_check_failed",
      diagnostic: { stage: "club_lock_ownership", code: "LEASE_CHECK_FAILED" },
    },
  );
});

Deno.test("inventory and availability query failures never become an empty or zero pool", () => {
  assertEquals(
    assessCoreQueryFailure("dealer_inventory", { code: "42703", message: "column missing" }),
    {
      dispatchState: "dependency_unavailable",
      dispatchErrorCode: "dealer_inventory_dependency_unavailable",
      diagnostic: { stage: "dealer_inventory", code: "42703" },
    },
  );
  assertEquals(
    assessCoreQueryFailure("available_dealer_count", { code: "XX000", message: "reset" }),
    {
      dispatchState: "partial",
      dispatchErrorCode: "available_dealer_count_query_failed",
      diagnostic: { stage: "available_dealer_count", code: "XX000" },
    },
  );
});

Deno.test("a successful empty inventory and an available count of zero keep valid no-dealer semantics", () => {
  assertEquals(assessDealerInventory([], null), { dealerIds: [], failure: null });
  assertEquals(assessAvailableDealerCount(0, null), { count: 0, failure: null });
  assertEquals(
    assessAvailableDealerCount(null, null),
    {
      count: null,
      failure: {
        dispatchState: "partial",
        dispatchErrorCode: "available_dealer_count_query_failed",
        diagnostic: { stage: "available_dealer_count", code: "QUERY_FAILED" },
      },
    },
  );
});

Deno.test("all-tables-OT alert is suppressed when either count query is invalid", () => {
  assertEquals(
    assessAllTablesOtAlert(true, { count: null, error: { code: "XX000" } }, { count: 0, error: null }),
    {
      shouldSend: false,
      failure: {
        dispatchState: "partial",
        dispatchErrorCode: "all_tables_ot_total_active_query_failed",
        diagnostic: { stage: "all_tables_ot_total_active", code: "XX000" },
      },
    },
  );
  assertEquals(
    assessAllTablesOtAlert(true, { count: 19, error: null }, { count: null, error: { code: "XX000" } }),
    {
      shouldSend: false,
      failure: {
        dispatchState: "partial",
        dispatchErrorCode: "all_tables_ot_non_overtime_query_failed",
        diagnostic: { stage: "all_tables_ot_non_overtime", code: "XX000" },
      },
    },
  );
});

Deno.test("a successful all-tables-OT snapshot and no-dealer path retain their intended outcomes", () => {
  assertEquals(
    assessAllTablesOtAlert(true, { count: 19, error: null }, { count: 0, error: null }),
    { shouldSend: true, totalActiveCount: 19 },
  );
  assertEquals(
    assessAllTablesOtAlert(true, { count: 19, error: null }, { count: 1, error: null }),
    { shouldSend: false, failure: null },
  );
});

Deno.test("a settings query failure never defaults shortage Telegram to enabled", () => {
  assertEquals(
    assessShortageNotifySetting(null, { code: "XX000", message: "reset" }),
    {
      notify: false,
      failure: {
        dispatchState: "partial",
        dispatchErrorCode: "shortage_notify_setting_query_failed",
        diagnostic: { stage: "shortage_notify_setting", code: "XX000" },
      },
    },
  );
  assertEquals(assessShortageNotifySetting(null, null), { notify: true, failure: null });
  assertEquals(
    assessShortageNotifySetting({ shortage_notify_telegram: false }, null),
    { notify: false, failure: null },
  );
});
