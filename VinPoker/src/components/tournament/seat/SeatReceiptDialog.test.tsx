import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SeatReceiptDialog } from "./SeatReceiptDialog";
const mocks = vi.hoisted(() => ({ floor: vi.fn(), canvas: vi.fn(), save: vi.fn(), client: {} }));
vi.mock("./floorSeatTicketCore", () => ({ fetchFloorSeatTicketWithClient: mocks.floor }));
vi.mock("html2canvas", () => ({ default: mocks.canvas }));
vi.mock("jspdf", () => ({ jsPDF: class { addImage() {} save = mocks.save; } }));

vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({
  useSupabaseClient: () => mocks.client,
}));
vi.mock("./buyinReceiptCore", () => ({
  fetchBuyinReceiptWithClient: () => Promise.resolve(null),
  toSeatReceiptData: vi.fn(),
}));

describe("SeatReceiptDialog printing", () => {
  beforeEach(() => { mocks.floor.mockReset(); mocks.canvas.mockReset(); mocks.save.mockReset(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("writes a static HTML title and assigns a historical code only as text", () => {
    const document = { write: vi.fn(), close: vi.fn(), title: "" };
    const printWindow = { document, focus: vi.fn(), print: vi.fn(), close: vi.fn() };
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

  it("never prints an unverified or superseded floor ticket using the fallback", async () => {
    mocks.floor.mockRejectedValue(new Error("ticket_not_current"));
    const open = vi.spyOn(window, "open");
    const view = render(<SeatReceiptDialog open onOpenChange={vi.fn()} receipt={{
      tournamentName: "TEST", playerName: "TEST", tableNumber: 1, seatNumber: 2,
      receiptCode: "SEAT-QR", qrValue: "SEAT-QR", startingStack: 10000,
      floorSeatContext: { actorId: "actor", tournamentId: "tour", entryId: "entry" },
    }} />);
    try {
      expect(await screen.findByRole("alert")).toHaveTextContent("ticket_not_current");
      expect(screen.getByRole("button", { name: /^In$/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /PDF/ })).toBeDisabled();
      expect(open).not.toHaveBeenCalled();
    } finally { view.unmount(); }
  });

  it("uses server stack-at-issue and rejects an old actor's late proof", async () => {
    let finishOld!: (value: unknown) => void;
    mocks.floor.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
      .mockResolvedValueOnce({ tournamentName: "TEST", playerName: "TEST", tableNumber: 2, seatNumber: 3,
        receiptCode: "NEW", qrValue: "NEW", startingStack: 20000 });
    const receipt = { tournamentName: "TEST", playerName: "TEST", tableNumber: 1, seatNumber: 2,
      receiptCode: "OLD", qrValue: "OLD", startingStack: 10000,
      floorSeatContext: { actorId: "actor-a", tournamentId: "tour", entryId: "entry" } };
    const view = render(<SeatReceiptDialog open onOpenChange={vi.fn()} receipt={receipt} />);
    try {
      expect(screen.getByRole("button", { name: /^In$/i })).toBeDisabled();
      view.rerender(<SeatReceiptDialog open onOpenChange={vi.fn()} receipt={{ ...receipt, receiptCode: "NEW",
        floorSeatContext: { ...receipt.floorSeatContext, actorId: "actor-b" } }} />);
      await waitFor(() => expect(mocks.floor).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.getByRole("button", { name: /^In$/i })).toBeEnabled());
      await act(async () => { finishOld({ ...receipt, startingStack: 30000 }); });
      expect(screen.getByText("NEW")).toBeInTheDocument();
      expect(screen.queryByText("OLD")).not.toBeInTheDocument();
    } finally { view.unmount(); }
  });

  it("rechecks a floor ticket at export and closes the blank window if it became invalid", async () => {
    const floorSeatContext = { actorId: "actor", tournamentId: "tour", entryId: "entry" };
    const receipt = { tournamentName: "TEST", playerName: "TEST", tableNumber: 1, seatNumber: 2,
      receiptCode: "SEAT-QR", qrValue: "SEAT-QR", startingStack: 20000, floorSeatContext };
    mocks.floor.mockResolvedValueOnce(receipt).mockRejectedValueOnce(new Error("ticket_not_current"));
    const printWindow = { document: { write: vi.fn(), close: vi.fn(), title: "" }, focus: vi.fn(), print: vi.fn(), close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(printWindow as unknown as Window);
    const view = render(<SeatReceiptDialog open onOpenChange={vi.fn()} receipt={receipt} />);
    try {
      await waitFor(() => expect(screen.getByRole("button", { name: /^In$/i })).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: /^In$/i }));
      expect(await screen.findByRole("alert")).toHaveTextContent("ticket_not_current");
      expect(printWindow.close).toHaveBeenCalledTimes(1);
      expect(printWindow.document.write).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: /^In$/i })).toBeDisabled();
    } finally { view.unmount(); }
  });

  it("does not save a PDF after unmount while capture is pending", async () => {
    const receipt = { tournamentName: "TEST", playerName: "TEST", tableNumber: 1, seatNumber: 2,
      receiptCode: "CODE", qrValue: "CODE", startingStack: 20000,
      floorSeatContext: { actorId: "actor", tournamentId: "tour", entryId: "entry" } };
    mocks.floor.mockResolvedValue(receipt);
    let finishCapture!: (value: unknown) => void;
    mocks.canvas.mockImplementation(() => new Promise((resolve) => { finishCapture = resolve; }));
    const view = render(<SeatReceiptDialog open onOpenChange={vi.fn()} receipt={receipt} />);
    try {
      await waitFor(() => expect(screen.getByRole("button", { name: /PDF/ })).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: /PDF/ }));
      await waitFor(() => expect(mocks.canvas).toHaveBeenCalledTimes(1));
      view.unmount();
      await act(async () => { finishCapture({ width: 100, height: 100, toDataURL: () => "data:image/png;base64,TEST" }); });
      expect(mocks.save).not.toHaveBeenCalled();
    } finally { view.unmount(); }
  });

  it("does not let an old export denial poison a reopened same-scope proof", async () => {
    const receipt = { tournamentName: "TEST", playerName: "TEST", tableNumber: 1, seatNumber: 2,
      receiptCode: "CODE", qrValue: "CODE", startingStack: 20000,
      floorSeatContext: { actorId: "actor", tournamentId: "tour", entryId: "entry" } };
    let rejectOld!: (error: Error) => void;
    mocks.floor.mockResolvedValueOnce(receipt)
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }))
      .mockResolvedValueOnce(receipt);
    const printWindow = { document: { write: vi.fn(), close: vi.fn(), title: "" }, focus: vi.fn(), print: vi.fn(), close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(printWindow as unknown as Window);
    const view = render(<SeatReceiptDialog open onOpenChange={vi.fn()} receipt={receipt} />);
    try {
      await waitFor(() => expect(screen.getByRole("button", { name: /^In$/i })).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: /^In$/i }));
      await waitFor(() => expect(mocks.floor).toHaveBeenCalledTimes(2));
      view.rerender(<SeatReceiptDialog open={false} onOpenChange={vi.fn()} receipt={receipt} />);
      view.rerender(<SeatReceiptDialog open onOpenChange={vi.fn()} receipt={receipt} />);
      await waitFor(() => expect(screen.getByRole("button", { name: /^In$/i })).toBeEnabled());
      await act(async () => { rejectOld(new Error("old-export-error")); });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^In$/i })).toBeEnabled();
      expect(printWindow.close).toHaveBeenCalledTimes(1);
      expect(printWindow.document.write).not.toHaveBeenCalled();
    } finally { view.unmount(); }
  });

  it.each(["reopen", "unmount"])("does not print a delayed window from an old dialog lifetime: %s", async (action) => {
    const receipt = { tournamentName: "TEST", playerName: "TEST", tableNumber: 1, seatNumber: 2,
      receiptCode: "CODE", qrValue: "CODE", startingStack: 20000,
      floorSeatContext: { actorId: "actor", tournamentId: "tour", entryId: "entry" } };
    mocks.floor.mockResolvedValue(receipt);
    const printWindow = { document: { write: vi.fn(), close: vi.fn(), title: "" }, focus: vi.fn(), print: vi.fn(), close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(printWindow as unknown as Window);
    const view = render(<SeatReceiptDialog open onOpenChange={vi.fn()} receipt={receipt} />);
    try {
      await waitFor(() => expect(screen.getByRole("button", { name: /^In$/i })).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: /^In$/i }));
      await waitFor(() => expect(printWindow.document.write).toHaveBeenCalledTimes(1));
      if (action === "reopen") {
        view.rerender(<SeatReceiptDialog open={false} onOpenChange={vi.fn()} receipt={receipt} />);
        view.rerender(<SeatReceiptDialog open onOpenChange={vi.fn()} receipt={receipt} />);
      } else view.unmount();
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
      expect(printWindow.print).not.toHaveBeenCalled();
      expect(printWindow.close).toHaveBeenCalledTimes(1);
    } finally { view.unmount(); }
  });
});
