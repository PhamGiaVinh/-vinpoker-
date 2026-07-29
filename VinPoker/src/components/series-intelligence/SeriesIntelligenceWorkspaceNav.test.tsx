import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { SeriesIntelligenceWorkspaceNav } from "./SeriesIntelligenceWorkspaceNav";

afterEach(cleanup);

function renderNav(active: "operations" | "market") {
  return render(
    <MemoryRouter>
      <SeriesIntelligenceWorkspaceNav active={active} />
    </MemoryRouter>,
  );
}

describe("SeriesIntelligenceWorkspaceNav", () => {
  it("links Series operations to the read-only market workspace", () => {
    renderNav("operations");

    expect(
      screen.getByRole("navigation", { name: "Khu vực Trí tuệ Series" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Vận hành Series" })).toHaveAttribute(
      "href",
      "/club/admin/series-intelligence",
    );
    expect(screen.getByRole("link", { name: "Dữ liệu thị trường" })).toHaveAttribute(
      "href",
      "/club/admin/market-intelligence",
    );
  });

  it("marks only the current workspace as active", () => {
    const { rerender } = renderNav("operations");

    expect(screen.getByRole("link", { name: "Vận hành Series" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Dữ liệu thị trường" })).not.toHaveAttribute(
      "aria-current",
    );

    rerender(
      <MemoryRouter>
        <SeriesIntelligenceWorkspaceNav active="market" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Dữ liệu thị trường" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Vận hành Series" })).not.toHaveAttribute(
      "aria-current",
    );
  });
});
