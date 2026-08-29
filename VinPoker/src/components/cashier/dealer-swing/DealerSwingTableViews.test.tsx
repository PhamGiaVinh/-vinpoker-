import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DealerSwingTableViews } from "./DealerSwingTableViews";

describe("DealerSwingTableViews", () => {
  it("keeps the Battle Map selected by default and mounts only the selected view", () => {
    render(
      <DealerSwingTableViews
        mapContent={<div>canonical battle map</div>}
        allocationContent={<div>table allocation board</div>}
      />,
    );

    expect(screen.getByRole("tab", { name: "Bản đồ chiến trường" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("canonical battle map")).toBeInTheDocument();
    expect(screen.queryByText("table allocation board")).not.toBeInTheDocument();

    const allocationTab = screen.getByRole("tab", { name: "Bảng theo bàn" });
    fireEvent.mouseDown(allocationTab, { button: 0 });

    expect(screen.getByRole("tab", { name: "Bảng theo bàn" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("table allocation board")).toBeInTheDocument();
    expect(screen.queryByText("canonical battle map")).not.toBeInTheDocument();
  });
});
