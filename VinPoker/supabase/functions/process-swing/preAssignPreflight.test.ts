import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assessPreAssignPreflight } from "./preAssignPreflight.ts";

const now = Date.parse("2026-07-19T10:00:00.000Z");

Deno.test("preflight fails closed on query error", () => {
  const result = assessPreAssignPreflight(null, { message: "column does not exist" }, 15, now);
  assertEquals(result, { kind: "query_error", error: "column does not exist" });
});

Deno.test("preflight classifies missing and stale attendance as invalid", () => {
  assertEquals(assessPreAssignPreflight(null, null, 15, now).kind, "invalid");
  assertEquals(assessPreAssignPreflight({
    current_state: "available",
    status: "checked_in",
    last_released_at: null,
    dealers: { full_name: "Stale dealer" },
  }, null, 15, now).kind, "invalid");
  assertEquals(assessPreAssignPreflight({
    current_state: "checked_out",
    status: "checked_out",
    last_released_at: null,
    dealers: { full_name: "Checked out" },
  }, null, 15, now).kind, "invalid");
});

Deno.test("preflight preserves the 15 minute rest floor", () => {
  const row = {
    current_state: "pre_assigned",
    status: "checked_in",
    last_released_at: new Date(now - 14 * 60_000).toISOString(),
    dealers: [{ full_name: "Resting dealer" }],
  };
  const blocked = assessPreAssignPreflight(row, null, 15, now);
  assertEquals(blocked.kind, "rest_blocked");

  const ready = assessPreAssignPreflight(
    { ...row, last_released_at: new Date(now - 15 * 60_000).toISOString() },
    null,
    15,
    now,
  );
  assertEquals(ready.kind, "ready");
  if (ready.kind === "ready") assertEquals(ready.attendance.full_name, "Resting dealer");
});
