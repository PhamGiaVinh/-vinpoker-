import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FloorTableModePicker } from "../../src/components/ops/shared/FloorTableModePicker";

afterEach(cleanup);

describe("FloorTableModePicker", () => {
  it("shows distinct visual cards and changes the selected table mode", () => {
    const onChange = vi.fn();

    render(<FloorTableModePicker value="manual" onChange={onChange} />);

    const manual = screen.getByTestId("floor-open-mode-manual");
    const tracker = screen.getByTestId("floor-open-mode-tracker");
    expect(manual).toHaveAttribute("role", "radio");
    expect(manual).toHaveAttribute("aria-checked", "true");
    expect(tracker).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("FLOOR ĐIỀU HÀNH")).toBeInTheDocument();
    expect(screen.getByText("BÀN LIVE")).toBeInTheDocument();

    fireEvent.click(tracker);
    expect(onChange).toHaveBeenCalledWith("tracker");
  });
});
