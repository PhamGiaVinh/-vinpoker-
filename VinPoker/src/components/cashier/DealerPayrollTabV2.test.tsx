import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DealerPayrollTabV2 from "./DealerPayrollTabV2";

vi.mock("@/components/cashier/DealerPayrollTab", () => ({
  default: () => <div>Monthly payroll</div>,
}));

vi.mock("@/components/cashier/DealerPtWageTab", () => ({
  default: ({ readOnly }: { readOnly?: boolean }) => (
    <div>{readOnly ? "PT wages read-only" : "PT wages editable"}</div>
  ),
}));

describe("DealerPayrollTabV2 customer preview", () => {
  it("opens the part-time view first and keeps it read-only", () => {
    render(<DealerPayrollTabV2 clubIds={["club-1"]} clubs={[{ id: "club-1", name: "HSOP" }]} />);

    expect(screen.getByRole("tab", { name: "Theo giờ · Part-time" })).toHaveAttribute("data-state", "active");
    expect(screen.getByText("Bản xem trước chỉ đọc")).toBeInTheDocument();
    expect(screen.getByText("PT wages read-only")).toBeInTheDocument();
    expect(screen.queryByText("Monthly payroll")).not.toBeInTheDocument();
  });
});
