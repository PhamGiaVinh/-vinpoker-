import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ShowdownInputPanel, type ShowdownPlayer } from "@/components/cashier/tournament-live/handinput/ShowdownInputPanel";
import type { Card } from "@/components/shared/CardSlotPicker";

const players: ShowdownPlayer[] = [
  { player_id: "p1", seat_number: 1, display_name: "An", is_folded: false },
  { player_id: "p2", seat_number: 3, display_name: "Binh", is_folded: false },
  { player_id: "p3", seat_number: 5, display_name: "Cuong", is_folded: true },
];
const board: (Card | null)[] = ["As", "Kh", "7s", "2c", "9h"] as (Card | null)[];
const noop = () => {};

const common = {
  players,
  board,
  holeCards: {},
  usedCards: new Set<Card>(),
  onHoleCardChange: noop,
  onReveal: noop,
  onToggleWinner: noop,
  onConfirmResult: noop,
};

describe("ShowdownInputPanel", () => {
  it("shows the showdown header, the MANUAL winner label, and only still-in players", () => {
    const html = renderToStaticMarkup(<ShowdownInputPanel {...common} selectedWinners={[]} />);
    expect(html).toContain("Showdown");
    expect(html).toContain("Chọn người thắng");
    expect(html).toContain("Chọn người thắng thủ công — hệ thống chưa tự đánh giá bài trong phiên bản này.");
    expect(html).toContain("An");
    expect(html).toContain("Binh");
    expect(html).not.toContain("Cuong"); // folded → not at showdown
  });

  it("'Xác nhận kết quả' is DISABLED until a winner is selected", () => {
    const none = renderToStaticMarkup(<ShowdownInputPanel {...common} selectedWinners={[]} />);
    // the confirm button carries the disabled attribute when no winner chosen
    expect(none).toContain("Xác nhận kết quả");
    expect(none).toContain('disabled=""');

    const picked = renderToStaticMarkup(<ShowdownInputPanel {...common} selectedWinners={["p1"]} />);
    expect(picked).not.toContain('disabled=""');
  });
});
