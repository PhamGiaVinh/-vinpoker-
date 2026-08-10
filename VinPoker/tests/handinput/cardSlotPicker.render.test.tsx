import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CardSlotPicker } from "@/components/shared/CardSlotPicker";

afterEach(cleanup);

describe("CardSlotPicker", () => {
  it("opens a collision-aware portal with accessible 44px card controls", () => {
    render(<CardSlotPicker value={null} used={new Set()} onChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Chọn lá bài" }));

    const rank = screen.getByRole("button", { name: "Chọn hạng A" });
    expect(rank).toHaveClass("min-h-11");
    expect(rank.closest('[data-radix-popper-content-wrapper]')).not.toBeNull();
  });

  it("labels an existing card and exposes suit choices by keyboard name", () => {
    render(<CardSlotPicker value="As" used={new Set(["As"])} onChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /Đổi lá A/ }));
    expect(screen.getAllByRole("button", { name: /Chọn A/ })).toHaveLength(4);
    expect(screen.getAllByRole("button", { name: /Chọn A/ })[0]).toHaveClass("min-h-11");
  });
});
