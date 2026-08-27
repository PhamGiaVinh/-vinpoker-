import { describe, expect, it, vi } from "vitest";

import { fetchBuyinReceiptWithClient, toSeatReceiptData, type BuyinReceiptSnapshot } from "./buyinReceiptCore";

const snapshot: BuyinReceiptSnapshot = {
  registration_id: "registration-1",
  receipt_code: "SEAT-QR-1",
  qr_value: "SEAT-QR-1",
  reference_code: "VINREG-REF-1",
  status: "confirmed",
  club: { name: "CLB A", address: "1 Đường A", logo_url: "https://example.test/logo.png" },
  player_name: "Nguyễn Văn A",
  tournament_name: "Deepstack tên rất dài",
  total_pay: 2_300_000,
  completed_at: "2026-08-15T13:24:00.000Z",
  completed_at_source: "confirmed_at",
  table_number: 3,
  seat_number: 8,
  starting_stack: 30_000,
};

describe("toSeatReceiptData", () => {
  it("keeps the backend seat QR distinct from the player-facing confirmation code", () => {
    const receipt = toSeatReceiptData(snapshot);

    expect(receipt.qrValue).toBe("SEAT-QR-1");
    expect(receipt.receiptCode).toBe("SEAT-QR-1");
    expect(receipt.confirmationCode).toBe("VINREG-REF-1");
    expect(receipt.totalPay).toBe(2_300_000);
  });

  it("uses legacy values only for fields the read-only snapshot does not provide", () => {
    const receipt = toSeatReceiptData(
      { ...snapshot, club: { name: null, address: null, logo_url: null }, table_number: null, seat_number: null },
      {
        tournamentName: "Legacy tournament",
        playerName: "Legacy player",
        tableNumber: 2,
        seatNumber: 5,
        receiptCode: "legacy-code",
        qrValue: "legacy-code",
        clubName: "Legacy club",
      },
    );

    expect(receipt.clubName).toBe("Legacy club");
    expect(receipt.tableNumber).toBe(2);
    expect(receipt.seatNumber).toBe(5);
    expect(receipt.playerName).toBe("Nguyễn Văn A");
  });
});

describe("fetchBuyinReceiptWithClient", () => {
  it("keeps the Edge receipt request server-authorized through the injected client", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { receipt: snapshot }, error: null });
    const result = await fetchBuyinReceiptWithClient({ functions: { invoke } } as never, { receiptCode: "SEAT-QR-1" });

    expect(invoke).toHaveBeenCalledWith("get-buyin-receipt", { body: { receipt_code: "SEAT-QR-1" } });
    expect(result).toEqual(snapshot);
  });
});
