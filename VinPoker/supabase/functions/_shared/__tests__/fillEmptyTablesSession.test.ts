import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { getDealerOperationalTables } from "../dealerOperationalTables.ts";
const table = { id: "table-1", table_session_id: "session-1", table_name: "Floor cash",
  table_type: "cash", tournament_id: null, shift_id: null, opened_at: null,
  dealer_open_operation_id: null, current_blind_level: null };
Deno.test("inventory accepts an exact Floor cash session without legacy shift/marker", async () => {
  const admin = { rpc: async (name: string, args: Record<string, unknown>) => {
    assertEquals(name,"get_dealer_operational_tables_v1"); assertEquals(args,{ p_club_id: "club-1" });
    return { data: [table], error: null };
  }};
  assertEquals(await getDealerOperationalTables(admin,"club-1"),[table]);
});
Deno.test("inventory fails closed for missing session, duplicate table or malformed tournament", async () => {
  for (const data of [[{ ...table, table_session_id: null }],[table,table],[{ ...table, table_type: "tournament" }]]) {
    await assertRejects(() => getDealerOperationalTables({ rpc: async () => ({ data, error: null }) },"club-1"));
  }
});
Deno.test("inventory propagates backend failure rather than claim an empty room", async () => {
  await assertRejects(() => getDealerOperationalTables({ rpc: async () => { throw new Error("503"); } },"club-1"));
});
