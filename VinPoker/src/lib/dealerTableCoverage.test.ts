import { describe, expect, it } from "vitest";
import { dealerTableCoverage } from "./dealerTableCoverage";
describe("Swing table coverage", () => {
  it("counts open tables rather than the whole physical inventory", () => {
    expect(dealerTableCoverage([{ id: "a", status: "active", table_session_id: "new" }, { id: "b", status: "inactive" }], [
      { table_id: "a", table_session_id: "new", status: "assigned", released_at: null },
      { table_id: "a", table_session_id: "new", status: "assigned", released_at: null },
    ])).toEqual({ activeTables: 1, assignedTables: 1 });
  });
  it("does not count a released or previous-session assignment as coverage", () => {
    expect(dealerTableCoverage([{ id: "a", status: "active", table_session_id: "new" }], [
      { table_id: "a", table_session_id: "old", status: "assigned", released_at: null },
      { table_id: "a", table_session_id: "new", status: "assigned", released_at: "now" },
    ])).toEqual({ activeTables: 1, assignedTables: 0 });
  });
});
