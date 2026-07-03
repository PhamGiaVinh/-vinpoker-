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

// ── UAT wave 2 (trackerCoverCallRunout): skip-reveal escape on the runout panel ──
// Needs interactivity (2-tap confirm) → testing-library, not static markup.
import { render, cleanup, fireEvent } from "@testing-library/react";
import { vi, afterEach } from "vitest";

afterEach(() => cleanup());

describe("ShowdownInputPanel — revealOnly skip escape (UAT wave 2)", () => {
  const revealCommon = { ...common, selectedWinners: [] as string[], revealOnly: true, onRevealAndContinue: noop };

  it("no onSkipReveal → markup byte-identical to today's revealOnly panel (tripwire)", () => {
    const plain = renderToStaticMarkup(<ShowdownInputPanel {...revealCommon} />);
    expect(plain).not.toContain("Tiếp tục không lật");
    expect(plain).not.toContain("Bài sẽ không hiển thị trên viewer");
  });

  it("with onSkipReveal → the amber escape block + exact warning copy render", () => {
    const html = renderToStaticMarkup(<ShowdownInputPanel {...revealCommon} onSkipReveal={noop} />);
    expect(html).toContain("Tiếp tục không lật (không có thông tin bài)");
    expect(html).toContain("Bài sẽ không hiển thị trên viewer. Bạn vẫn phải chấm kết quả thủ công ở Showdown.");
  });

  it("2-tap confirm: first tap arms (no fire), second tap fires the handler", () => {
    const onSkip = vi.fn();
    const { getByText } = render(<ShowdownInputPanel {...revealCommon} onSkipReveal={onSkip} />);
    const btn = getByText("Tiếp tục không lật (không có thông tin bài)");
    fireEvent.click(btn);
    expect(onSkip).not.toHaveBeenCalled();
    expect(getByText("Bấm lần nữa để xác nhận")).toBeTruthy();
    fireEvent.click(getByText("Bấm lần nữa để xác nhận"));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("disabled while submitting", () => {
    const html = renderToStaticMarkup(<ShowdownInputPanel {...revealCommon} onSkipReveal={noop} submitting />);
    const btnChunk = html.split("Tiếp tục không lật")[0];
    expect(btnChunk.slice(-400)).toContain('disabled=""');
  });

  it("escape stays available even when the live players are NOT resolved (its purpose)", () => {
    // holeCards empty → allLiveResolved=false → primary reveal disabled, escape enabled.
    const html = renderToStaticMarkup(<ShowdownInputPanel {...revealCommon} onSkipReveal={noop} />);
    expect(html).toContain("Cần đủ 2 lá tẩy cho mỗi người còn bài");
    expect(html).toContain("Tiếp tục không lật (không có thông tin bài)");
  });
});
