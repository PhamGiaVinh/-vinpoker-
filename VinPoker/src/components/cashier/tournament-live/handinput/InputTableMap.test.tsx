// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InputTableMap } from "./InputTableMap";

afterEach(cleanup);

describe("InputTableMap", () => {
  it("marks the exact physical table with unresolved Floor alerts", () => {
    render(<InputTableMap
      tables={[
        { id: "table-5", physicalTableId: "physical-5", tournamentTableId: "tt-5", name: "Bàn 5", playerCount: 6, hasLiveHand: true },
        { id: "table-6", physicalTableId: "physical-6", tournamentTableId: "tt-6", name: "Bàn 6", playerCount: 0, hasLiveHand: false },
      ]}
      activeTableId={null}
      onSelect={vi.fn()}
      alertsByTable={{ "physical-5": 2 }}
    />);

    expect(screen.getByRole("button", { name: /Bàn 5.*2 cảnh báo cần Floor xử lý/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /Bàn 6/i })).not.toHaveTextContent("cảnh báo");
  });
});
