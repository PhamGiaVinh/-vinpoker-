import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SeatReceipt } from "./SeatReceipt";

describe("SeatReceipt", () => {
  it("renders a confirmed buy-in receipt with real receipt and reference codes", () => {
    const { container } = render(
      <SeatReceipt
        tournamentName="Center Point Poker Club – P Evening Deepstack Turbo"
        playerName="Phạm Gia Vinh Nguyễn Văn Tên Rất Dài"
        tableNumber={12}
        seatNumber={9}
        receiptCode="SEAT-RECEIPT-QR"
        qrValue="SEAT-RECEIPT-QR"
        status="confirmed"
        clubName="Center Point Poker Club"
        clubAddress="123 Đường Mẫu, Quận 1"
        totalPay={2_300_000}
        completedAt="2026-08-15T13:24:00.000Z"
        completedAtSource="confirmed_at"
        confirmationCode="VINREG852B0VEG"
      />,
    );

    expect(screen.getByText("PHIẾU BUY-IN")).toBeInTheDocument();
    expect(screen.getByText("BUY-IN RECEIPT")).toBeInTheDocument();
    expect(screen.getByText("2.300.000 VND")).toBeInTheDocument();
    expect(screen.getByText("Bàn 12 · Ghế 9")).toBeInTheDocument();
    expect(screen.getByText("VINREG852B0VEG")).toBeInTheDocument();
    expect(screen.getByText("Nghiêm cấm các vận động viên lợi dụng việc tập huấn, thi đấu thể thao để thực hiện hành vi trái pháp luật.")).toBeInTheDocument();
    expect(screen.queryByText(/undefined|null|NaN/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Phiếu Buy-in")).toHaveStyle({ width: "302px", maxWidth: "100%" });
    expect(container.querySelector("svg")).toHaveAttribute("width", "150");
    expect(container.querySelector("svg")).toHaveAttribute("height", "150");
  });

  it("shows the unassigned state without inventing a table or seat", () => {
    render(
      <SeatReceipt
        tournamentName="TEST"
        playerName="Người chơi"
        tableNumber={null}
        seatNumber={null}
        receiptCode="SEAT-RECEIPT-QR"
        qrValue="SEAT-RECEIPT-QR"
      />,
    );

    expect(screen.getByText("Chưa xếp bàn")).toBeInTheDocument();
    expect(screen.queryByText(/Bàn .*Ghế/)).not.toBeInTheDocument();
  });
});
