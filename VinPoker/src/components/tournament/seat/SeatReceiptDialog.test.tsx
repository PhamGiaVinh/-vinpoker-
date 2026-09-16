import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SeatReceiptDialog } from "./SeatReceiptDialog";

vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({
  useSupabaseClient: () => ({}),
}));
vi.mock("./buyinReceiptCore", () => ({
  fetchBuyinReceiptWithClient: () => Promise.resolve(null),
  toSeatReceiptData: vi.fn(),
}));

describe("SeatReceiptDialog printing", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("writes a static HTML title and assigns a historical code only as text", () => {
    const document = { write: vi.fn(), close: vi.fn(), title: "" };
    const printWindow = { document, focus: vi.fn(), print: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(printWindow as unknown as Window);
    const historicalCode = '</title><script>window.bad=1</script><title>';

    render(<SeatReceiptDialog open onOpenChange={vi.fn()} receipt={{
      tournamentName: "TEST", playerName: "TEST", tableNumber: 1, seatNumber: 2,
      receiptCode: "SEAT-QR", qrValue: "SEAT-QR", confirmationCode: historicalCode,
    }} />);
    fireEvent.click(screen.getByRole("button", { name: /^In$/i }));

    expect(document.write).toHaveBeenCalledWith(expect.stringContaining("<title>Buy-in Receipt</title>"));
    expect(document.write.mock.calls[0][0]).not.toContain(historicalCode);
    expect(document.title).toBe(historicalCode);
  });
});
