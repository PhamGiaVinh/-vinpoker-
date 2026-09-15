import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DealerShotClock } from "./DealerShotClock";

afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("Dealer shot clock", () => {
  it("counts down without poker writes and stops at zero", () => {
    vi.useFakeTimers();
    render(<DealerShotClock turnKey="hand:flop:4" playerLabel="Ghế 4" active />);
    act(() => vi.advanceTimersByTime(31000));
    expect(screen.getByRole("timer").textContent).toBe("0");
    expect(screen.getByRole("status").textContent).toContain("Dealer xử lý");
  });
  it("pauses, extends, and resets on a new canonical turn", () => {
    vi.useFakeTimers();
    const { rerender } = render(<DealerShotClock turnKey="4" playerLabel="Ghế 4" active />);
    act(() => vi.advanceTimersByTime(5000));
    fireEvent.click(screen.getByRole("button", { name: "Tạm dừng" }));
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByRole("timer").textContent).toBe("25");
    fireEvent.click(screen.getByRole("button", { name: "30 giây" }));
    expect(screen.getByRole("timer").textContent).toBe("55");
    rerender(<DealerShotClock turnKey="6" playerLabel="Ghế 6" active />);
    expect(screen.getByRole("timer").textContent).toBe("30");
  });
  it("freezes during an uncertain write", () => {
    vi.useFakeTimers();
    render(<DealerShotClock turnKey="4" playerLabel="Ghế 4" active blocked />);
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByRole("timer").textContent).toBe("30");
    expect(screen.getByRole("button", { name: "Đặt lại" }).hasAttribute("disabled")).toBe(true);
  });
});
