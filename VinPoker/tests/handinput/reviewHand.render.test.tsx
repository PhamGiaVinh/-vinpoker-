import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewHandPanel, type ReviewPlayer } from "@/components/cashier/tournament-live/handinput/ReviewHandPanel";
import type { Card } from "@/components/shared/CardSlotPicker";

const players: ReviewPlayer[] = [
  { player_id: "p1", seat_number: 1, display_name: "An", starting_stack: 100, current_stack: 50 },
  { player_id: "p2", seat_number: 2, display_name: "Binh", starting_stack: 100, current_stack: 60 },
];
const board: (Card | null)[] = ["As", "Kh", "7s", null, null] as (Card | null)[];
const noop = () => {};

const common = {
  players,
  board,
  onEndingStackChange: noop,
  potSize: 90,
  onSubmit: noop,
  onBack: noop,
};

describe("ReviewHandPanel — chip-conservation gated submit", () => {
  it("blocks Submit and shows a reason when review is not valid", () => {
    // p1 collected the 90 pot but conservation is off / winner-not-yet — canSubmit false.
    const endingStacks = { p1: 50, p2: 60 }; // sum 110 ≠ start 200 → not conserved
    const html = renderToStaticMarkup(
      <ReviewHandPanel {...common} endingStacks={endingStacks} conservationOk={false} winnerDetermined={false} canSubmit={false} />
    );
    expect(html).toContain("Submit Hand");
    expect(html).toContain("Chưa thể gửi hand"); // blocked reason
    expect(html).toContain('disabled=""'); // submit disabled
    expect(html).toContain("✗ Bảo toàn chip"); // conservation failed marker
  });

  it("enables Submit when chips are conserved AND a winner is determined", () => {
    const endingStacks = { p1: 140, p2: 60 }; // p1 + pot 90 = 140; sum 200 == start 200
    const html = renderToStaticMarkup(
      <ReviewHandPanel {...common} endingStacks={endingStacks} conservationOk winnerDetermined canSubmit />
    );
    expect(html).toContain("✓ Bảo toàn chip");
    expect(html).toContain("✓ Đã có người thắng");
    expect(html).not.toContain('disabled=""'); // submit enabled
  });
});

// A3 (trackerChipQuickEdit) — additive rankShifts strip. Absent/empty → byte-identical.
describe("ReviewHandPanel — rankShifts strip (A3)", () => {
  const endingStacks = { p1: 140, p2: 60 };

  it("rankShifts absent → no strip (flag-OFF operator path)", () => {
    const html = renderToStaticMarkup(
      <ReviewHandPanel {...common} endingStacks={endingStacks} conservationOk winnerDetermined canSubmit />
    );
    expect(html).not.toContain("Thứ hạng sau ván này");
  });

  it("rankShifts=[] → no strip", () => {
    const html = renderToStaticMarkup(
      <ReviewHandPanel {...common} endingStacks={endingStacks} conservationOk winnerDetermined canSubmit rankShifts={[]} />
    );
    expect(html).not.toContain("Thứ hạng sau ván này");
  });

  it("rankShifts present → renders a row per shift with before → after and a direction arrow", () => {
    const html = renderToStaticMarkup(
      <ReviewHandPanel
        {...common}
        endingStacks={endingStacks}
        conservationOk
        winnerDetermined
        canSubmit
        rankShifts={[
          { player_id: "p1", seat_number: 1, display_name: "An", before: 4, after: 1 },
          { player_id: "p2", seat_number: 2, display_name: "Binh", before: 2, after: 5 },
        ]}
      />
    );
    expect(html).toContain("Thứ hạng sau ván này");
    expect(html).toContain("#4 → #1");
    expect(html).toContain("▲"); // An moved up
    expect(html).toContain("#2 → #5");
    expect(html).toContain("▼"); // Binh moved down
  });
});
