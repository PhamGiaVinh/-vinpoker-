// RPT committed-bet chip STACK on the felt (viewerLayout only): a pointer-events-none
// layer places a 3-disc pile + amount in front of each betting/all-in seat, toward the
// pot (collision-guarded). Operator/TV (viewerLayout off) render NO stack → byte-identical.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveFelt, type SeatInfo } from "@/components/cashier/tournament-live/LiveFelt";

const noBB = () => null;

function seat(over: Partial<SeatInfo>): SeatInfo {
  return {
    player_id: over.player_id ?? "p",
    display_name: over.display_name ?? "P",
    seat_number: over.seat_number ?? 1,
    chip_count: over.chip_count ?? 1000,
    is_active: true,
    table_id: "t",
    position: "",
    ...over,
  };
}

const baseProps = {
  lastActorId: null,
  toActId: null,
  displayCards: ["", "", "", "", ""],
  potSize: 0,
  potBreakdown: null,
  multiTableUnresolved: false,
  handNumber: 1,
  latestAction: null,
  formatBB: noBB,
};

const stackCount = (html: string) => (html.match(/z-\[15\]/g) || []).length;

describe("LiveFelt committed-bet chip stack (viewerLayout)", () => {
  it("renders the felt stack layer ONLY under viewerLayout (none for operator/TV)", () => {
    const s = [seat({ player_id: "a", seat_number: 1, current_bet: 200000 })];
    expect(stackCount(renderToStaticMarkup(<LiveFelt seats={s} {...baseProps} />))).toBe(0);
    expect(stackCount(renderToStaticMarkup(<LiveFelt seats={s} {...baseProps} portrait viewerLayout />))).toBe(1);
  });

  it("one stack per betting/all-in seat; folded or no-bet seats get none", () => {
    const s = [
      seat({ player_id: "a", seat_number: 1, current_bet: 200000 }), // bet → stack
      seat({ player_id: "b", seat_number: 2, is_all_in: true, current_bet: 5_000_000 }), // all-in → stack
      seat({ player_id: "c", seat_number: 3 }), // no bet → none
      seat({ player_id: "d", seat_number: 4, is_folded: true, current_bet: 100 }), // folded → none
    ];
    expect(stackCount(renderToStaticMarkup(<LiveFelt seats={s} {...baseProps} portrait viewerLayout />))).toBe(2);
  });

  it("all-in stack is RED (#d33), a regular stack is GOLD (#f5b340)", () => {
    const allin = renderToStaticMarkup(
      <LiveFelt seats={[seat({ player_id: "a", seat_number: 1, is_all_in: true, current_bet: 5_000_000 })]} {...baseProps} portrait viewerLayout />
    ).toLowerCase();
    expect(allin).toContain("#d33");
    expect(allin).not.toContain("#f5b340");
    const reg = renderToStaticMarkup(
      <LiveFelt seats={[seat({ player_id: "a", seat_number: 1, current_bet: 200000 })]} {...baseProps} portrait viewerLayout />
    ).toLowerCase();
    expect(reg).toContain("#f5b340");
  });

  it("the amount label is real text; the decorative discs are aria-hidden", () => {
    const html = renderToStaticMarkup(
      <LiveFelt seats={[seat({ player_id: "a", seat_number: 1, current_bet: 200000 })]} {...baseProps} portrait viewerLayout />
    );
    expect(html).toContain("200k"); // the amount label
    expect(html).toContain('aria-hidden="true"'); // the discs
  });

  it("places the stack BETWEEN the seat and the pot center (toward-center lerp)", () => {
    // Seat 5 portrait-V2 sits at t≈8%; the pot center ≈42%. Its stack must land between.
    const html = renderToStaticMarkup(
      <LiveFelt seats={[seat({ player_id: "a", seat_number: 5, current_bet: 200000 })]} {...baseProps} portrait viewerLayout />
    );
    const m = html.match(/z-\[15\][^>]*top:([0-9.]+)%/);
    expect(m).toBeTruthy();
    const top = parseFloat(m![1]);
    expect(top).toBeGreaterThan(8); // moved down from the seat toward the pot
    expect(top).toBeLessThan(42); // but kept clear of the pot/board
  });
});
