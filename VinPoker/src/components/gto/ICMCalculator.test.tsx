import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import ICMCalculator from "./ICMCalculator";

afterEach(() => { cleanup(); toast.error.mockClear(); });

describe("ICMCalculator inputs", () => {
  it("clears the prior result and rejects a negative payout", () => {
    render(<ICMCalculator />);
    expect(screen.queryAllByText("—")).toHaveLength(0);
    fireEvent.change(screen.getByRole("spinbutton", { name: "1st payout" }), { target: { value: "-50" } });
    fireEvent.click(screen.getByRole("button", { name: /icmCalc.recalc/ }));
    expect(toast.error).toHaveBeenCalledWith("icmCalc.errPrizes");
    expect(screen.getAllByText("—")).toHaveLength(5);
  });

  it("rejects non-finite stacks before calculating", () => {
    render(<ICMCalculator />);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Player 1 chips" }), { target: { value: "1e309" } });
    fireEvent.click(screen.getByRole("button", { name: /icmCalc.recalc/ }));
    expect(toast.error).toHaveBeenCalledWith("icmCalc.errChips");
  });
});
