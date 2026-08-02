import { describe, expect, it } from "vitest";
import { closeTableErrorMessage, parseCloseTableResult, parseCloseTableRpcResult } from "@/components/cashier/tournament-live/closeTableResponse";

const move = {
  player_name: "Player A",
  from_seat: 3,
  to_table_number: 2,
  to_seat_number: 5,
  receipt_code: "T2-S5-ABC123",
};

describe("close-table client containment", () => {
  it("accepts only a complete server success receipt", () => {
    expect(parseCloseTableResult({ ok: true, closed: true, moved_count: 1, moved: [move] }, 1)).toMatchObject({ kind: "success" });
  });

  it("accepts the legacy empty-table success shape only for an empty source table", () => {
    expect(parseCloseTableResult({ ok: true, closed: true, moved: [] }, 0)).toMatchObject({ kind: "success" });
    expect(parseCloseTableResult({ ok: true, closed: true, moved: [] }, 1)).toMatchObject({
      kind: "error",
      code: "invalid_response",
    });
  });

  it("accepts a complete already-closed idempotent receipt without replaying moves", () => {
    expect(parseCloseTableResult({
      ok: true,
      closed: true,
      already_closed: true,
      moved_count: 0,
      moved: [],
    }, 3)).toMatchObject({
      kind: "success",
      response: { already_closed: true, moved_count: 0 },
    });
  });

  it("never renders a zero-move response as success for a populated source table", () => {
    expect(parseCloseTableResult({ ok: true, closed: true, moved_count: 0, moved: [] }, 1)).toMatchObject({
      kind: "error",
      code: "unexpected_zero_moves",
    });
  });

  it("rejects malformed receipts instead of assuming an empty table", () => {
    expect(parseCloseTableResult({ ok: true, closed: true, moved_count: 2, moved: [move] }, 2)).toMatchObject({
      kind: "error",
      code: "invalid_response",
    });
    expect(parseCloseTableResult(null, 0)).toMatchObject({ kind: "error", code: "invalid_response" });
  });

  it("surfaces the server unlinked-seat result without a legacy retry path", () => {
    const response = {
      ok: false,
      error: "UNLINKED_ACTIVE_SEATS",
      total_active_seats: 3,
      unlinked_active_seats: 2,
    };
    expect(parseCloseTableResult(response, 3)).toMatchObject({ kind: "error", code: "UNLINKED_ACTIVE_SEATS" });
    expect(closeTableErrorMessage(response)).toContain("2/3");
  });

  it("explains mismatch and active-hand guards without implying a partial write", () => {
    expect(closeTableErrorMessage({ ok: false, error: "seat_entry_mismatch" }))
      .toBe("Ghế và entry không khớp. Không có dữ liệu nào bị thay đổi.");
    expect(closeTableErrorMessage({
      ok: false,
      error: "table_has_active_hand",
      hand_id: "50000000-0000-4000-8000-000000000001",
    })).toBe("Bàn đang có hand hoạt động. Hãy hoàn tất hoặc xử lý hand trước khi đóng bàn.");
  });

  it("parses the real supabase-js data/error split without mislabeling a database error", () => {
    const unlinked = { ok: false, error: "UNLINKED_ACTIVE_SEATS", total_active_seats: 1, unlinked_active_seats: 1 };
    expect(parseCloseTableRpcResult(unlinked, null, 1)).toMatchObject({ kind: "error", code: "UNLINKED_ACTIVE_SEATS" });

    const databaseError = { code: "42501", message: "permission denied", details: null, hint: null };
    expect(parseCloseTableRpcResult(null, databaseError, 1)).toMatchObject({
      kind: "error",
      code: "42501",
      rpcError: databaseError,
    });
  });
});
