import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BlindSetupPanel,
  type BlindSetupPlayer,
} from "@/components/cashier/tournament-live/handinput/BlindSetupPanel";

const players: BlindSetupPlayer[] = [
  { player_id: "p1", seat_number: 7, display_name: "An", current_stack: 10000 },
  { player_id: "p2", seat_number: 8, display_name: "Binh", current_stack: 50 }, // short → BB all-in
];

const baseProps = {
  buttonSeat: 6,
  sbSeat: 7,
  bbSeat: 8,
  firstActorSeat: 9,
  isHeadsUp: false,
  players,
  levelNumber: 3 as number | null,
  ante: 0,
  levelMissing: false,
  sbAmount: 100,
  bbAmount: 200, // ≥ p2 stack 50 → all-in indicator
  onSbAmountChange: () => {},
  onBbAmountChange: () => {},
  sbPosted: false,
  bbPosted: false,
  onPost: () => {},
  onConfirm: () => {},
};

describe("BlindSetupPanel (engine-mode blind setup phase)", () => {
  it("renders the setup header, SB/BB seats, post buttons, confirm + UTG hint", () => {
    const html = renderToStaticMarkup(<BlindSetupPanel {...baseProps} />);
    expect(html).toContain("Thiết lập blind");
    expect(html).toContain("Small Blind");
    expect(html).toContain("Big Blind");
    expect(html).toContain("Level 3");
    expect(html).toContain("Ghế 7"); // SB seat
    expect(html).toContain("Ghế 8"); // BB seat
    expect(html).toContain("Post SB");
    expect(html).toContain("Post BB");
    expect(html).toContain("Xác nhận blind");
    expect(html).toContain("UTG (ghế 9)"); // first actor hint
  });

  it("shows an all-in indicator when a blind ≥ that seat's stack", () => {
    const html = renderToStaticMarkup(<BlindSetupPanel {...baseProps} />);
    expect(html).toContain("(All-in)"); // BB 200 ≥ Binh's 50
  });

  it("heads-up note replaces the UTG hint", () => {
    const html = renderToStaticMarkup(
      <BlindSetupPanel {...baseProps} isHeadsUp sbSeat={6} bbSeat={8} />
    );
    expect(html).toContain("Heads-up: Button là Small Blind và hành động trước preflop.");
  });

  it("refresh-safe: when SB+BB are already posted it shows 'Đã post' and no duplicate Post buttons", () => {
    const html = renderToStaticMarkup(
      <BlindSetupPanel {...baseProps} sbPosted bbPosted />
    );
    expect((html.match(/Đã post/g) || []).length).toBe(2);
    expect(html).not.toContain("Post SB");
    expect(html).not.toContain("Post BB");
  });

  it("shows a manual-override warning when the Floor level is missing", () => {
    const html = renderToStaticMarkup(
      <BlindSetupPanel {...baseProps} levelMissing levelNumber={null} />
    );
    expect(html).toContain("manual override");
  });
});
