import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isExactOperationalAssignment } from "./pass3SessionFence.ts";
import type { DealerOperationalTable } from "../_shared/dealerOperationalTables.ts";

const tables = [{ id: "table-4", table_session_id: "session-a" }] as DealerOperationalTable[];
Deno.test("Pass3 accepts exact canonical session regardless of stale physical status", () => {
  assertEquals(isExactOperationalAssignment(tables, { table_id: "table-4", table_session_id: "session-a" }), true);
});
Deno.test("Pass3 rejects reused physical table, NULL session and missing inventory", () => {
  for (const assignment of [
    { table_id: "table-4", table_session_id: "session-old" },
    { table_id: "table-4", table_session_id: null },
    { table_id: "another-table", table_session_id: "session-a" },
  ]) assertEquals(isExactOperationalAssignment(tables, assignment), false);
  assertEquals(isExactOperationalAssignment([], { table_id: "table-4", table_session_id: "session-a" }), false);
});
Deno.test("Pass3 never auto-releases on a reusable physical marker", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(!source.includes('release_reason: "table_inactive_auto_release"'));
  assert(!source.includes('assignment.game_tables.status !== "active"'));
  assert(source.includes("getDealerOperationalTables(admin, cid)"));
  assert(source.includes("isExactOperationalAssignment(pass3OperationalTables, assignment)"));
});
