import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  OperatorActionLog,
  type LogAction,
} from "@/components/cashier/tournament-live/handinput/OperatorActionLog";
import type { Card } from "@/components/shared/CardSlotPicker";

const board: (Card | null)[] = ["As", "Kh", "Td", "2c", null] as (Card | null)[];

const actions: LogAction[] = [
  { street: "preflop", display_name: "An", seat_number: 1, action_type: "raise", amount: 5000 },
  { street: "preflop", display_name: "Bình", seat_number: 2, action_type: "call", amount: 2400 },
  { street: "flop", display_name: "An", seat_number: 1, action_type: "bet", amount: 6000 },
  { street: "turn", display_name: "Bình", seat_number: 2, action_type: "fold", amount: 0 },
];

describe("OperatorActionLog (grouped action log)", () => {
  it("renders the header and an empty-state when no actions exist", () => {
    const html = renderToStaticMarkup(<OperatorActionLog actions={[]} communityCards={board} />);
    expect(html).toContain("Nhật ký thao tác");
    expect(html).toContain("Chưa có action nào được ghi nhận");
  });

  it("groups actions under their street headers and formats each action", () => {
    const html = renderToStaticMarkup(<OperatorActionLog actions={actions} communityCards={board} />);
    expect(html).toContain("Preflop");
    expect(html).toContain("Flop");
    expect(html).toContain("Turn");
    expect(html).toContain("Raise 5,000");
    expect(html).toContain("Call 2,400");
    expect(html).toContain("Bet 6,000");
    expect(html).toContain("Fold");
    // seat chips
    expect(html).toContain("S1");
    expect(html).toContain("S2");
  });

  it("does not render a street section with no actions", () => {
    const html = renderToStaticMarkup(<OperatorActionLog actions={actions} communityCards={board} />);
    // no river/showdown actions were supplied
    expect(html).not.toContain("River");
    expect(html).not.toContain("Showdown");
  });
});
