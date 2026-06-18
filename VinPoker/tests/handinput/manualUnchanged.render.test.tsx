import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ActionDock } from "@/components/cashier/tournament-live/handinput/ActionDock";
import { ActionStepPanel } from "@/components/cashier/tournament-live/handinput/ActionStepPanel";
import type { RailSeat } from "@/components/cashier/tournament-live/handinput/SeatRail";
import type { ActorView } from "@/lib/tracker-poker/handFlow";

// GATE #1 tripwire — manual byte-identical. The engine wizard introduces a NEW
// ActionStepPanel and leaves the manual ActionDock untouched. This proves the two
// paths stay distinct: the manual ActionDock keeps its street-advance footer
// ("Sang Turn" / "Hoàn tất"), while the engine ActionStepPanel has no such footer
// (the state machine advances streets). If a refactor ever merged them, one of
// these assertions breaks.

const noop = () => {};

const ACTOR: RailSeat = { player_id: "B", seat_number: 2, display_name: "Bình", current_stack: 18200, current_bet: 50 };
const VIEW: ActorView = {
  toCall: 2400,
  minRaiseTo: 5000,
  legal: { fold: true, check: false, call: true, bet: false, raise: true, allIn: true },
};

describe("manual ActionDock stays intact (GATE #1)", () => {
  it("manual ActionDock still renders the street-advance footer", () => {
    const html = renderToStaticMarkup(
      <ActionDock
        actor={ACTOR}
        actorPosition="SB"
        view={VIEW}
        betAmount="6000"
        onBetAmountChange={noop}
        bigBlind={600}
        onAction={noop}
        needsPostSB={false}
        needsPostBB={false}
        streetLabel="Flop"
        nextStreetLabel="Turn"
        onNextStreet={noop}
        onComplete={noop}
        canComplete={true}
        onUndo={noop}
        canUndo={true}
        onReset={noop}
        onVoid={noop}
        hasVoidTarget={true}
      />
    );
    expect(html).toContain("Sang Turn");
    expect(html).toContain("Hoàn tất");
  });

  it("engine ActionStepPanel does NOT render a street-advance footer", () => {
    const html = renderToStaticMarkup(
      <ActionStepPanel
        actor={ACTOR}
        actorPosition="SB"
        view={VIEW}
        betAmount="6000"
        onBetAmountChange={noop}
        bigBlind={600}
        onAction={noop}
        needsPostSB={false}
        needsPostBB={false}
        betIsTotal
      />
    );
    expect(html).not.toContain("Sang Turn");
    expect(html).not.toContain("Hoàn tất");
  });
});
