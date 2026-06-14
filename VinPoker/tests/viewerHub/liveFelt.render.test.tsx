import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveFelt, type SeatInfo } from "@/components/cashier/tournament-live/LiveFelt";

const noBB = () => null;

function seat(over: Partial<SeatInfo>): SeatInfo {
  return {
    player_id: over.player_id ?? "p",
    display_name: over.display_name ?? "Player",
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

// Count card elements inside each seat's hole-card slot only (NOT the board).
function seatCardCounts(html: string): number[] {
  // Each seat slot is <div data-testid="seat-holecards" ...> ...two cards... </div>
  const slots = html.split('data-testid="seat-holecards"').slice(1);
  return slots.map((seg) => {
    // The slot's own content ends at the seat wrapper close; count card-back +
    // face-up cards before the next seat slot. Face-up PokerCards carry
    // "tracker-card-reveal"; backs carry data-testid="card-back".
    const cut = seg.length; // segment already starts right after one slot's attr
    const region = seg.slice(0, cut);
    const backs = (region.match(/data-testid="card-back"/g) || []).length;
    const faces = (region.match(/tracker-card-reveal/g) || []).length;
    return backs + faces;
  });
}

describe("LiveFelt redesign render", () => {
  it("shows the gold V felt mark", () => {
    const html = renderToStaticMarkup(<LiveFelt seats={[]} {...baseProps} />);
    expect(html).toContain('data-testid="felt-v"');
  });

  it("renders exactly 2 card BACKS for each active seat with no revealed hole cards", () => {
    const seats = [
      seat({ player_id: "a", seat_number: 1 }),
      seat({ player_id: "b", seat_number: 2 }),
      seat({ player_id: "c", seat_number: 3 }),
    ];
    const html = renderToStaticMarkup(<LiveFelt seats={seats} {...baseProps} />);
    // 3 seat slots, each with exactly 2 card elements (all backs here).
    const counts = seatCardCounts(html);
    expect(counts.length).toBe(3);
    counts.forEach((c) => expect(c).toBe(2));
    expect((html.match(/data-testid="card-back"/g) || []).length).toBe(6);
  });

  it("renders face-up cards (not backs) only when exactly 2 hole cards are revealed", () => {
    const seats = [
      seat({ player_id: "a", seat_number: 1, hole_cards: ["Ah", "Kd"] }), // revealed → faces
      seat({ player_id: "b", seat_number: 2 }), // hidden → 2 backs
    ];
    const html = renderToStaticMarkup(<LiveFelt seats={seats} {...baseProps} />);
    const counts = seatCardCounts(html);
    expect(counts).toEqual([2, 2]); // every active seat still has exactly 2
    expect((html.match(/data-testid="card-back"/g) || []).length).toBe(2); // only seat b
  });

  it("never invents cards: a seat with only 1 hole card falls back to 2 backs", () => {
    const seats = [seat({ player_id: "a", seat_number: 1, hole_cards: ["Ah"] })];
    const html = renderToStaticMarkup(<LiveFelt seats={seats} {...baseProps} />);
    expect((html.match(/data-testid="card-back"/g) || []).length).toBe(2);
  });
});
