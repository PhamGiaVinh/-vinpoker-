// B1 (liveReplayHud → ReplayScrubber `hud`) — the RPT-style replay HUD. Pins:
// hud absent → byte-identical scrubber (no HUD bar / tabs / jump-to-end); hud →
// BB/POT bar uses the HAND's OWN blind, TÓM TẮT shows winner rows ±BB from
// ending−starting stacks + bullets from actions only (no hole-card source).
import { describe, it, expect } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { ReplayScrubber } from "@/components/cashier/tournament-live/ReplayScrubber";
import type { ReplayHand } from "@/lib/tracker-poker/replayEngine";

// jsdom has no ResizeObserver; the Radix <Slider> inside the scrubber needs one.
class ROStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver || ROStub;

const hand: ReplayHand = {
  hand_number: 141,
  button_seat: 1,
  community_cards: ["Th", "7c", "6d", "7s", "Ah"],
  big_blind: 300000, // the HAND's own level — ±BB must use this
  players: [
    { player_id: "a", seat_number: 1, display_name: "GUIDO", starting_stack: 12300000, ending_stack: 10200000 },
    { player_id: "b", seat_number: 2, display_name: "KIÊN", starting_stack: 2400000, ending_stack: 4500000 },
  ],
  actions: [
    { player_id: "a", street: "preflop", action_type: "post_sb", action_amount: 150000, action_order: 1 },
    { player_id: "b", street: "preflop", action_type: "post_bb", action_amount: 300000, action_order: 2 },
    { player_id: "b", street: "preflop", action_type: "all_in", action_amount: 2100000, action_order: 3 },
    { player_id: "a", street: "preflop", action_type: "call", action_amount: 1950000, action_order: 4 },
  ],
};

afterEach(() => cleanup());

describe("ReplayScrubber B1 HUD (additive `hud` prop)", () => {
  it("hud absent → no HUD bar, no tabs, no jump-to-end (byte-identical scrubber)", () => {
    const { container, queryByTestId, queryByTitle } = render(<ReplayScrubber hand={hand} onFrame={() => {}} />);
    expect(queryByTestId("replay-hud-bar")).toBeNull();
    expect(queryByTestId("replay-hud-summary")).toBeNull();
    expect(queryByTitle("Tới cuối (showdown)")).toBeNull();
    expect(container.textContent).not.toContain("Tóm tắt");
  });

  it("hud → BB/POT bar renders with the hand's own blind (300k)", () => {
    const { getByTestId } = render(<ReplayScrubber hand={hand} onFrame={() => {}} hud />);
    expect(getByTestId("replay-hud-bar").textContent).toContain("300k");
    expect(getByTestId("replay-hud-bar").textContent).toContain("POT");
  });

  it("hud → TÓM TẮT default tab shows winner rows ±BB from ending−starting", () => {
    const { getByTestId } = render(<ReplayScrubber hand={hand} onFrame={() => {}} hud />);
    const s = getByTestId("replay-hud-summary").textContent || "";
    expect(s).toContain("KIÊN"); // winner +2.1M
    expect(s).toContain("+2.1M");
    expect(s).toContain("7.0 BB"); // 2.1M / 300k — the HAND's blind, not any clock
    expect(s).toContain("GUIDO"); // loser -2.1M
    expect(s).toContain("all-in 2.1M"); // bullet from the all_in action
  });

  it("hud → jump-to-end lands on the final frame (step N/N)", () => {
    const { getByTitle, container } = render(<ReplayScrubber hand={hand} onFrame={() => {}} hud />);
    fireEvent.click(getByTitle("Tới cuối (showdown)"));
    const last = hand.actions.length; // frames = actions + initial
    expect(container.textContent).toContain(`${last}/${last}`);
  });

  it("hud → HÀNH ĐỘNG tab still lists every action", () => {
    const { getByText, container } = render(<ReplayScrubber hand={hand} onFrame={() => {}} hud />);
    fireEvent.click(getByText("Hành động"));
    expect(container.textContent).toContain("All-In");
    expect(container.textContent).toContain("Call");
  });
});

// ── UAT wave 2 (Fix 3): trackBets forwards into the frames the scrubber emits ──
describe("ReplayScrubber trackBets (additive prop)", () => {
  it("absent → frames carry NO bet keys (byte-identical); set → current_bet present", () => {
    let plainFrame: any = null;
    let betsFrame: any = null;
    render(<ReplayScrubber hand={hand} onFrame={(f) => (plainFrame = f)} />);
    render(<ReplayScrubber hand={hand} onFrame={(f) => (betsFrame = f)} trackBets />);
    expect(plainFrame).toBeTruthy();
    expect(betsFrame).toBeTruthy();
    expect(plainFrame.seats.some((s: any) => "current_bet" in s)).toBe(false);
    expect(betsFrame.seats.every((s: any) => "current_bet" in s)).toBe(true);
  });
});
