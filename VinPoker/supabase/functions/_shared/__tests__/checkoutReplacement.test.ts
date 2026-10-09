import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkoutReplacementTarget } from "../checkoutReplacement.ts";
const assigned = { id: "assignment-a", table_id: "table-a", table_session_id: "session-a", status: "assigned" };
Deno.test("checkout replacement preserves exact assignment incarnation", () => {
  assertEquals(checkoutReplacementTarget([assigned, { ...assigned, id: "old-break", status: "on_break" }]), assigned);
});
Deno.test("checkout replacement refuses legacy null session or ambiguous active assignments", () => {
  assertEquals(checkoutReplacementTarget([{ ...assigned, table_session_id: null }]), null);
  assertEquals(checkoutReplacementTarget([assigned, { ...assigned, id: "assignment-b", table_session_id: "session-b" }]), null);
  assertEquals(checkoutReplacementTarget([]), null);
});
