import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PlayerActionSheets } from "@/components/ops/shared/PlayerActionSheets";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PlayerActionSheets", () => {
  it("renders its closed receipt sheet without a missing icon reference", () => {
    expect(() => render(
      <PlayerActionSheets
        target={null}
        onClose={vi.fn()}
        onSaveChip={async () => false}
        onBustPlayer={async () => false}
        onOpenBust={async () => true}
        bustInfo={null}
        moveTargets={[]}
        onMovePlayer={async () => false}
        onOpenReceipt={vi.fn()}
        infoLive
        bustControlMode={null}
      />,
    )).not.toThrow();
  });

  it("keeps an unbroken test player name within the mobile bust confirmation", async () => {
    const longName = "CODEX_FLOOR_UAT_20260724114346_7ff9d2e8af0e";
    const openBust = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    render(
      <PlayerActionSheets
        target={{ seat: { seat: 2, name: longName, chip: "0" }, tableNo: 2, chipCount: 0 }}
        onClose={vi.fn()}
        onSaveChip={async () => false}
        onBustPlayer={async () => false}
        onOpenBust={openBust}
        bustInfo={{ loading: false, place: 4, prize: null }}
        moveTargets={[]}
        onMovePlayer={async () => false}
        onOpenReceipt={vi.fn()}
        infoLive
        bustControlMode="manual"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Loại/ }));
    await waitFor(() => expect(openBust).toHaveBeenCalledTimes(1));
    const playerName = await screen.findByText(longName);
    expect(playerName).toHaveClass("break-all");
    expect(screen.getByRole("button", { name: "Xác nhận loại" })).toHaveClass("w-full", "min-w-0");
  });

  it("shows the audit-only consequence before a Manual Floor non-zero-chip bust", async () => {
    const openBust = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    render(
      <PlayerActionSheets
        target={{ seat: { seat: 1, name: "Manual player", chip: "125" }, tableNo: 3, chipCount: 125 }}
        onClose={vi.fn()}
        onSaveChip={async () => false}
        onBustPlayer={async () => false}
        onOpenBust={openBust}
        bustInfo={{ loading: false, place: 3, prize: null }}
        moveTargets={[]}
        onMovePlayer={async () => false}
        onOpenReceipt={vi.fn()}
        infoLive
        bustControlMode="manual"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Loại/ }));
    expect(await screen.findByText(/Bàn Manual Floor: người chơi còn 125 chip/)).toBeInTheDocument();
    expect(screen.getByText(/không tạo payout/)).toBeInTheDocument();
  });

  it("does not offer Floor chip editing when Live Tracker owns the stack", () => {
    render(
      <PlayerActionSheets
        target={{ seat: { seat: 4, name: "Tracker player", chip: "100" }, tableNo: 1, chipCount: 100 }}
        onClose={vi.fn()}
        onSaveChip={async () => false}
        onBustPlayer={async () => false}
        onOpenBust={async () => true}
        bustInfo={null}
        moveTargets={[]}
        onMovePlayer={async () => false}
        onOpenReceipt={vi.fn()}
        infoLive
        bustControlMode="tracker"
        chipEditDisabledReason="Bàn Live Tracker do Tracker quản lý chip."
      />,
    );

    expect(screen.getByRole("button", { name: /Sửa chip/i })).toBeDisabled();
    expect(screen.getByText("Tracker quản lý chip")).toBeInTheDocument();
  });
});
