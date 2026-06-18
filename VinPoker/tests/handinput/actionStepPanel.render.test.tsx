import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ActionStepPanel } from "@/components/cashier/tournament-live/handinput/ActionStepPanel";
import type { RailSeat } from "@/components/cashier/tournament-live/handinput/SeatRail";
import type { ActorView } from "@/lib/tracker-poker/handFlow";

const noop = () => {};

const ACTOR: RailSeat = {
  player_id: "B",
  seat_number: 2,
  display_name: "Bình",
  current_stack: 18200,
  current_bet: 50,
};

const VIEW_RAISE: ActorView = {
  toCall: 2400,
  minRaiseTo: 5000,
  legal: { fold: true, check: false, call: true, bet: false, raise: true, allIn: true },
};
const VIEW_NONE: ActorView = {
  toCall: 0,
  minRaiseTo: 0,
  legal: { fold: false, check: false, call: false, bet: false, raise: false, allIn: false },
};

const base = {
  betAmount: "6000",
  onBetAmountChange: noop,
  bigBlind: 600,
  onAction: noop,
  needsPostSB: false,
  needsPostBB: false,
  betIsTotal: true,
};

const disabledCount = (html: string) => (html.match(/disabled=""/g) || []).length;

describe("ActionStepPanel (guided single-actor step)", () => {
  it("shows the to-act header, the actor identity, and the legal action buttons", () => {
    const html = renderToStaticMarkup(
      <ActionStepPanel actor={ACTOR} actorPosition="SB" view={VIEW_RAISE} {...base} />
    );
    expect(html).toContain("Đến lượt");
    expect(html).toContain("Ghế 2 · Bình");
    expect(html).toContain("FOLD");
    expect(html).toContain("CHECK");
    expect(html).toContain("CALL");
    expect(html).toContain("ALL-IN");
  });

  it("has NO street-advance footer — never 'Sang …' / 'Hoàn tất' (state machine advances)", () => {
    const html = renderToStaticMarkup(
      <ActionStepPanel actor={ACTOR} actorPosition="SB" view={VIEW_RAISE} {...base} />
    );
    expect(html).not.toContain("Sang ");
    expect(html).not.toContain("Hoàn tất");
  });

  it("renders RAISE when legal.bet is false and BET when legal.bet is true", () => {
    const raise = renderToStaticMarkup(
      <ActionStepPanel actor={ACTOR} actorPosition="SB" view={VIEW_RAISE} {...base} />
    );
    expect(raise).toContain("RAISE");
    expect(raise).not.toContain(">BET<");

    const betView: ActorView = { toCall: 0, minRaiseTo: 0, legal: { fold: true, check: true, call: false, bet: true, raise: false, allIn: true } };
    const bet = renderToStaticMarkup(
      <ActionStepPanel actor={ACTOR} actorPosition="BB" view={betView} {...base} />
    );
    expect(bet).toContain("BET");
  });

  it("derives disabling from engine legality only — all-illegal disables more buttons than all-legal", () => {
    const allLegal: ActorView = { toCall: 2400, minRaiseTo: 5000, legal: { fold: true, check: true, call: true, bet: false, raise: true, allIn: true } };
    const open = renderToStaticMarkup(
      <ActionStepPanel actor={ACTOR} actorPosition="SB" view={allLegal} {...base} />
    );
    const closed = renderToStaticMarkup(
      <ActionStepPanel actor={ACTOR} actorPosition="SB" view={VIEW_NONE} {...base} />
    );
    expect(disabledCount(closed)).toBeGreaterThan(disabledCount(open));
  });

  it("posting mode shows a Post button and not the fold/call grid", () => {
    const html = renderToStaticMarkup(
      <ActionStepPanel actor={ACTOR} actorPosition="SB" view={null} {...base} needsPostSB />
    );
    expect(html).toContain("Post SB");
    expect(html).not.toContain("FOLD");
  });

  it("prompts to pick a seat when there is no actor", () => {
    const html = renderToStaticMarkup(
      <ActionStepPanel actor={null} actorPosition="" view={null} {...base} />
    );
    expect(html).toContain("Chạm một ghế để chọn người hành động.");
  });
});
