import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { SeatRail, type RailSeat } from "@/components/cashier/tournament-live/handinput/SeatRail";
import { ActionDock } from "@/components/cashier/tournament-live/handinput/ActionDock";
import { BetKeypad } from "@/components/cashier/tournament-live/handinput/BetKeypad";
import type { ActorView } from "@/lib/tracker-poker/handFlow";

const noop = () => {};

const SEATS: RailSeat[] = [
  { player_id: "A", seat_number: 1, display_name: "An", current_stack: 24500, current_bet: 0 },
  { player_id: "B", seat_number: 2, display_name: "Bình", current_stack: 18200, current_bet: 50 },
  { player_id: "C", seat_number: 3, display_name: "Cường", current_stack: 0, current_bet: 100, is_all_in: true },
];
const POSITIONS = new Map<number, string>([
  [1, "BTN"],
  [2, "SB"],
  [3, "BB"],
]);

const VIEW: ActorView = {
  toCall: 2400,
  minRaiseTo: 5000,
  legal: { fold: true, check: false, call: true, bet: false, raise: true, allIn: true },
};

describe("Hand Input tablet components render without throwing", () => {
  it("BetKeypad shows the bet-to value and keypad keys", () => {
    const html = renderToStaticMarkup(
      createElement(BetKeypad, { value: "6000", onChange: noop, bigBlind: 600 })
    );
    expect(html).toContain("Bet to");
    expect(html).toContain("000"); // the thousands key
    expect(html).toContain("6k"); // formatted value
  });

  it("SeatRail shows seats, positions and the to-act marker", () => {
    const html = renderToStaticMarkup(
      createElement(SeatRail, {
        seats: SEATS,
        positions: POSITIONS,
        buttonSeat: 1,
        toActId: "B",
        selectedActorId: null,
        onTapSeat: noop,
      })
    );
    expect(html).toContain("Bình");
    expect(html).toContain("BTN");
    expect(html).toContain("◀ lượt"); // to-act marker on seat B
    expect(html).toContain("ALL IN"); // seat C
  });

  it("SeatRail setup mode shows the BTN hint", () => {
    const html = renderToStaticMarkup(
      createElement(SeatRail, {
        seats: SEATS,
        positions: POSITIONS,
        buttonSeat: 2,
        toActId: null,
        selectedActorId: null,
        setupMode: true,
        onTapSeat: noop,
      })
    );
    expect(html).toContain("đặt nút chia bài");
  });

  it("ActionDock renders the actor, action buttons and footer", () => {
    const html = renderToStaticMarkup(
      createElement(ActionDock, {
        actor: SEATS[1],
        actorPosition: "SB",
        view: VIEW,
        betAmount: "6000",
        onBetAmountChange: noop,
        bigBlind: 600,
        onAction: noop,
        needsPostSB: false,
        needsPostBB: false,
        streetLabel: "Flop",
        nextStreetLabel: "Turn",
        onNextStreet: noop,
        onComplete: noop,
        canComplete: true,
        onReset: noop,
        onVoid: noop,
        hasVoidTarget: true,
      })
    );
    expect(html).toContain("Đến lượt");
    expect(html).toContain("Bình");
    expect(html).toContain("FOLD");
    expect(html).toContain("CALL");
    expect(html).toContain("ALL-IN");
    expect(html).toContain("Sang Turn");
    expect(html).toContain("Hoàn tất");
  });

  it("ActionDock shows a Post blind button when a blind is due", () => {
    const html = renderToStaticMarkup(
      createElement(ActionDock, {
        actor: SEATS[1],
        actorPosition: "SB",
        view: VIEW,
        betAmount: "300",
        onBetAmountChange: noop,
        bigBlind: 0,
        onAction: noop,
        needsPostSB: true,
        needsPostBB: false,
        streetLabel: "Preflop",
        nextStreetLabel: null,
        onNextStreet: noop,
        onComplete: noop,
        canComplete: false,
        onReset: noop,
        onVoid: noop,
        hasVoidTarget: false,
      })
    );
    expect(html).toContain("Post SB");
  });
});
