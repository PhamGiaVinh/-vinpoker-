import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { InputTableMap, type InputTableSummary } from "@/components/cashier/tournament-live/handinput/InputTableMap";

const tables: InputTableSummary[] = [
  { id: "tA", name: "Bàn 1", playerCount: 8, hasLiveHand: true },
  { id: "tB", name: "Bàn 2", playerCount: 6, hasLiveHand: false },
];

describe("InputTableMap (operator table picker)", () => {
  it("renders a tile per table with name, player count, picker title + active highlight", () => {
    const html = renderToStaticMarkup(
      <InputTableMap tables={tables} activeTableId="tA" onSelect={() => {}} />
    );
    expect(html).toContain("Chọn bàn để nhập hand"); // picker title (vi)
    expect(html).toContain("Bàn 1");
    expect(html).toContain("Bàn 2");
    expect(html).toContain("8 người chơi");
    expect(html).toContain("6 người chơi");
    expect(html).toContain("<svg"); // the table-logo icon
    expect(html).toContain('aria-pressed="true"'); // tA is the active tile
    expect(html).toContain('aria-pressed="false"'); // tB is not active
  });

  it("shows the live-hand badge ONLY for tables with an in-progress hand", () => {
    const html = renderToStaticMarkup(
      <InputTableMap tables={tables} activeTableId={null} onSelect={() => {}} />
    );
    // Only tA has hasLiveHand → exactly one "đang có hand" badge.
    expect((html.match(/đang có hand/g) || []).length).toBe(1);
  });

  it("renders even for a SINGLE table (unlike the spectator map, which hides)", () => {
    const html = renderToStaticMarkup(
      <InputTableMap tables={[tables[0]]} activeTableId={null} onSelect={() => {}} />
    );
    expect(html).not.toBe("");
    expect(html).toContain("Bàn 1");
  });

  it("shows an empty state when there are no tables", () => {
    const html = renderToStaticMarkup(
      <InputTableMap tables={[]} activeTableId={null} onSelect={() => {}} />
    );
    expect(html).toContain("Chưa có bàn nào");
  });
});
