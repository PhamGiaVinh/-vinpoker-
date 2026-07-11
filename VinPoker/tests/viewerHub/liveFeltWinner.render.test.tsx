// liveTableFx showdown winner treatment. At a replay's final frame the winning
// seat (net_won > 0) gets a gold glow + a green "+X (Y BB)" badge — but ONLY when
// the viewer passes `tableFx`. Operator / TV / live (no tableFx, or no net_won)
// render byte-identical. These pin both the presence and the prop-gating.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveFelt, type SeatInfo } from "@/components/cashier/tournament-live/LiveFelt";

function seat(over: Partial<SeatInfo>): SeatInfo {
  return {
    player_id: over.player_id ?? "p",
    display_name: over.display_name ?? "Player",
    seat_number: over.seat_number ?? 1,
    chip_count: over.chip_count ?? 41900000,
    is_active: true,
    table_id: "t",
    position: "",
    ...over,
  };
}

const baseProps = {
  lastActorId: null,
  toActId: null,
  displayCards: ["5d", "6d", "Ks", "Tc", "Ad"],
  potSize: 38300000,
  potBreakdown: null,
  multiTableUnresolved: false,
  handNumber: 1,
  latestAction: null,
  formatBB: (n: number) => `${(n / 500000).toFixed(1)} BB`,
};

const winner = seat({ player_id: "w", seat_number: 1, hole_cards: ["Kh", "3h"], net_won: 19400000 });
const loser = seat({ player_id: "l", seat_number: 2, hole_cards: ["7s", "4s"], net_won: -19400000 });

describe("LiveFelt showdown winner — under tableFx", () => {
  it("glows the winner + shows the green net-won badge with chips and BB", () => {
    const html = renderToStaticMarkup(<LiveFelt seats={[winner, loser]} {...baseProps} tableFx />);
    expect(html).toContain("tracker-win-glow"); // gold glow (avatar + cards)
    expect(html).toContain('data-testid="seat-net-won"');
    expect(html).toContain("+19.4M"); // formatStack of net_won
    expect(html).toContain("38.8 BB"); // formatBB(19.4M) = 19.4M/500k
  });

  it("only the winner (net_won > 0) is decorated — never the loser", () => {
    const html = renderToStaticMarkup(<LiveFelt seats={[winner, loser]} {...baseProps} tableFx />);
    // exactly one net-won badge and one card-glow + one avatar-glow → 2 glow uses, 1 badge
    expect((html.match(/seat-net-won/g) || []).length).toBe(1);
    expect((html.match(/tracker-win-glow/g) || []).length).toBe(2); // avatar + hole cards of the single winner
    expect(html).not.toContain("-19.4M"); // loser net is never rendered
  });

  it("WITHOUT tableFx (operator/TV/live path) nothing is decorated — byte-identical", () => {
    const html = renderToStaticMarkup(<LiveFelt seats={[winner, loser]} {...baseProps} />);
    expect(html).not.toContain("tracker-win-glow");
    expect(html).not.toContain("seat-net-won");
    expect(html).not.toContain("+19.4M");
  });

  it("a non-positive net_won never triggers the treatment", () => {
    const broke = seat({ player_id: "b", seat_number: 3, net_won: 0 });
    const html = renderToStaticMarkup(<LiveFelt seats={[broke, loser]} {...baseProps} tableFx />);
    expect(html).not.toContain("tracker-win-glow");
    expect(html).not.toContain("seat-net-won");
  });

  it("verified chop glows both winners and shows each credited pot share", () => {
    const chopA = seat({ player_id: "a", seat_number: 1, hole_cards: ["Ah", "Kd"], pot_winner: true, payout_award: 1000, net_won: 0 });
    const chopB = seat({ player_id: "b", seat_number: 2, hole_cards: ["As", "Kc"], pot_winner: true, payout_award: 1000, net_won: 0 });
    const html = renderToStaticMarkup(
      <LiveFelt seats={[chopA, chopB]} {...baseProps} tableFx showdownResult="chop" />,
    );
    expect((html.match(/tracker-win-glow/g) || []).length).toBe(4);
    expect((html.match(/seat-pot-award/g) || []).length).toBe(2);
    expect((html.match(/CHOP POT/g) || []).length).toBe(2);
    expect((html.match(/\+1k/g) || []).length).toBe(2);
  });
});
