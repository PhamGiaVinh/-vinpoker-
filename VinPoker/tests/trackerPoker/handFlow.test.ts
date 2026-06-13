import { describe, it, expect } from "vitest";
import {
  nextToAct,
  isBettingRoundComplete,
  actorView,
  highestBet,
  type FlowPlayer,
  type FlowInput,
} from "@/lib/tracker-poker/handFlow";

const P = (
  player_id: string,
  seat_number: number,
  current_bet: number,
  current_stack: number,
  opts: Partial<FlowPlayer> = {}
): FlowPlayer => ({
  player_id,
  seat_number,
  current_bet,
  current_stack,
  is_folded: false,
  is_all_in: false,
  ...opts,
});

// 3-handed: seat1 = BTN, seat2 = SB(50), seat3 = BB(100). Blinds posted, no
// voluntary action yet; BB was the last to "act" (post).
function afterBlinds(overrides: Partial<FlowInput> = {}): FlowInput {
  return {
    players: [P("P1", 1, 0, 10000), P("P2", 2, 50, 9950), P("P3", 3, 100, 9900)],
    buttonSeat: 1,
    actedThisStreet: new Set(),
    lastActorSeat: 3,
    bigBlind: 100,
    ...overrides,
  };
}

describe("highestBet / nextToAct", () => {
  it("UTG (seat after BB) acts first after the blinds", () => {
    const input = afterBlinds();
    expect(highestBet(input.players)).toBe(100);
    expect(nextToAct(input)).toBe("P1");
  });

  it("round is complete once everyone matched and acted", () => {
    const input = afterBlinds({
      players: [P("P1", 1, 100, 9900), P("P2", 2, 100, 9900), P("P3", 3, 100, 9900)],
      actedThisStreet: new Set(["P1", "P2", "P3"]),
    });
    expect(nextToAct(input)).toBeNull();
    expect(isBettingRoundComplete(input)).toBe(true);
  });

  it("BB still owes action (option) when checked to, even if bet is matched", () => {
    // P1 & P2 called to 100, P3 (BB) has 100 in but hasn't voluntarily acted.
    const input = afterBlinds({
      players: [P("P1", 1, 100, 9900), P("P2", 2, 100, 9900), P("P3", 3, 100, 9900)],
      actedThisStreet: new Set(["P1", "P2"]),
      lastActorSeat: 2,
    });
    expect(nextToAct(input)).toBe("P3");
    expect(actorView(input).legal.check).toBe(true); // option to check
    expect(actorView(input).legal.call).toBe(false); // nothing to call
  });

  it("skips folded and all-in players", () => {
    const input = afterBlinds({
      players: [
        P("P1", 1, 0, 10000, { is_folded: true }),
        P("P2", 2, 50, 9950, { is_all_in: true }),
        P("P3", 3, 100, 9900),
        P("P4", 4, 0, 8000),
      ],
      actedThisStreet: new Set(),
      lastActorSeat: 3,
    });
    expect(nextToAct(input)).toBe("P4");
  });
});

describe("actorView — legal actions facing a bet", () => {
  it("UTG facing the big blind: fold/call/raise/all-in legal, check illegal", () => {
    const v = actorView(afterBlinds(), "P1");
    expect(v.toCall).toBe(100);
    expect(v.legal).toMatchObject({
      fold: true, check: false, call: true, bet: false, raise: true, allIn: true,
    });
    expect(v.minRaiseTo).toBe(200); // highest 100 + bb 100
  });

  it("cannot bet when facing a bet (raise instead)", () => {
    expect(actorView(afterBlinds(), "P1").legal.bet).toBe(false);
  });

  it("raise needs chips beyond the call (short stack can only all-in/call)", () => {
    const input = afterBlinds({
      players: [P("P1", 1, 0, 80, {}), P("P2", 2, 50, 9950), P("P3", 3, 100, 9900)],
    });
    const v = actorView(input, "P1");
    expect(v.toCall).toBe(80); // clamped to the 80 stack (call all-in for less)
    expect(v.legal.raise).toBe(false);
    expect(v.legal.allIn).toBe(true);
  });

  it("a folded / all-in player has no legal actions", () => {
    const input = afterBlinds({
      players: [P("P1", 1, 0, 10000, { is_folded: true }), P("P3", 3, 100, 9900)],
    });
    const v = actorView(input, "P1");
    expect(v.legal).toMatchObject({ fold: false, check: false, call: false, raise: false, allIn: false });
  });
});

describe("actorView — postflop open (no bet yet)", () => {
  it("first to act can bet or check, not call/raise", () => {
    const input: FlowInput = {
      players: [P("P2", 2, 0, 9900), P("P3", 3, 0, 9900), P("P1", 1, 0, 9900)],
      buttonSeat: 1,
      actedThisStreet: new Set(),
      lastActorSeat: 1,
      bigBlind: 100,
    };
    expect(highestBet(input.players)).toBe(0);
    expect(nextToAct(input)).toBe("P2"); // first live seat after the button
    const v = actorView(input);
    expect(v.legal).toMatchObject({ check: true, bet: true, call: false, raise: false });
    expect(v.toCall).toBe(0);
  });
});
