import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VoidRegistrationDialog } from "./VoidRegistrationDialog";
afterEach(cleanup);
describe("refund request confirmation", () => {
  it("describes a request, not completed payment, and requires the server's minimum reason", () => {
    const onConfirm = vi.fn();
    render(<VoidRegistrationDialog open onOpenChange={vi.fn()} playerName="TEST Alice" referenceCode="TEST123"
      refundAmount={1000000} seatLabel="Bàn 1 · Ghế 2" busy={false} onConfirm={onConfirm} />);
    expect(screen.getByText(/Chỉ ghi nhận yêu cầu/)).toBeVisible();
    expect(screen.queryByText(/doanh thu.*tự trừ/)).toBeNull();
    const button = screen.getByRole("button", { name: "Gửi yêu cầu hoàn tiền" });
    fireEvent.change(screen.getByLabelText("Lý do huỷ (bắt buộc)"), { target: { value: "1234567" } });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Lý do huỷ (bắt buộc)"), { target: { value: "  Xác nhận nhầm  " } });
    fireEvent.click(button);
    expect(onConfirm).toHaveBeenCalledWith("Xác nhận nhầm");
  });
});
