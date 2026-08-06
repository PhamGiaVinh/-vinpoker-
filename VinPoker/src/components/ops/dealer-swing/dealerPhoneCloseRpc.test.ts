import { describe, expect, it } from "vitest";
import { DEALER_PHONE_CLOSE_RPC, parseDealerPhoneCloseResponse } from "./dealerPhoneCloseContract";

describe("dealer phone close RPC boundary", () => {
  it("uses the dedicated canonical RPC name", () => {
    expect(DEALER_PHONE_CLOSE_RPC).toBe("close_dealer_tables_phone_v1");
  });

  it("accepts a valid dry-run snapshot", () => {
    expect(parseDealerPhoneCloseResponse({
      outcome: "dry_run",
      operation_id: "operation-1",
      state_hash: "state-hash",
      tables: [{ table_id: "table-1", table_name: "Table 1", state_hash: "table-hash" }],
    })).toEqual({
      outcome: "dry_run",
      operation_id: "operation-1",
      state_hash: "state-hash",
      tables: [{ table_id: "table-1", table_name: "Table 1", state_hash: "table-hash" }],
    });
  });

  it("fails closed for malformed outcome payloads", () => {
    expect(parseDealerPhoneCloseResponse({ outcome: "completed", tables_closed: -1 })).toBeNull();
    expect(parseDealerPhoneCloseResponse({ outcome: "unexpected" })).toBeNull();
    expect(parseDealerPhoneCloseResponse({ outcome: "dry_run", tables: [{ table_id: "x" }] })).toBeNull();
  });
});
