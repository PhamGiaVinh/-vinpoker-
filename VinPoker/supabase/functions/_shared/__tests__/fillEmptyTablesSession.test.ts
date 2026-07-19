import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isRunningDealerSessionTable } from "../fillEmptyTables.ts";

const now = Date.parse("2026-07-19T10:00:00.000Z");
const base = {
  id: "table-1",
  shift_id: null,
  opened_at: null,
  dealer_open_operation_id: null,
};

Deno.test("auto-fill session accepts live tournament or requested shift", () => {
  assertEquals(isRunningDealerSessionTable(base, new Set([base.id]), undefined, false, now), true);
  assertEquals(
    isRunningDealerSessionTable({ ...base, shift_id: "shift-1" }, new Set(), "shift-1", false, now),
    true,
  );
});

Deno.test("auto-fill session accepts only unexpired durable marker", () => {
  const marked = {
    ...base,
    dealer_open_operation_id: "operation-1",
    opened_at: new Date(now - 23 * 60 * 60 * 1000).toISOString(),
  };
  assertEquals(isRunningDealerSessionTable(marked, new Set(), undefined, true, now), true);
  assertEquals(isRunningDealerSessionTable(marked, new Set(), undefined, false, now), false);
  assertEquals(
    isRunningDealerSessionTable(
      { ...marked, opened_at: new Date(now - 24 * 60 * 60 * 1000 - 1).toISOString() },
      new Set(),
      undefined,
      true,
      now,
    ),
    false,
  );
  assertEquals(
    isRunningDealerSessionTable(
      { ...marked, dealer_open_operation_id: null },
      new Set(),
      undefined,
      true,
      now,
    ),
    false,
  );
});
