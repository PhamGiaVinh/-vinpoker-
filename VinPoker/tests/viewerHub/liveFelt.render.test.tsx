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

// Count card elements inside each SEAT's hole-card slot only. The board is
// rendered BEFORE the seats, so it lands in the dropped slots[0] and never
// inflates a seat's count. Backs carry data-testid="card-back"; face-up
// PokerCards carry "tracker-card-reveal".
function seatCardCounts(html: string): number[] {
  const slots = html.split('data-testid="seat-holecards"').slice(1);
  return slots.map((seg) => {
    const backs = (seg.match(/data-testid="card-back"/g) || []).length;
    const faces = (seg.match(/tracker-card-reveal/g) || []).length;
    return backs + faces;
  });
}

// Isolate the community board region: from the board testid up to the first seat.
function boardSegment(html: string): string {
  const afterBoard = html.split('data-testid="board-cards"')[1] ?? "";
  return afterBoard.split('data-testid="seat-holecards"')[0] ?? "";
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
    const counts = seatCardCounts(html);
    expect(counts.length).toBe(3);
    counts.forEach((c) => expect(c).toBe(2));
  });

  it("renders face-up cards (not backs) only when exactly 2 hole cards are revealed", () => {
    const seats = [
      seat({ player_id: "a", seat_number: 1, hole_cards: ["Ah", "Kd"] }), // revealed → faces
      seat({ player_id: "b", seat_number: 2 }), // hidden → 2 backs
    ];
    const html = renderToStaticMarkup(<LiveFelt seats={seats} {...baseProps} />);
    expect(seatCardCounts(html)).toEqual([2, 2]); // every active seat still has exactly 2
    // Only seat a has face-up cards (board is all backs here → 0 reveals).
    expect((html.match(/tracker-card-reveal/g) || []).length).toBe(2);
  });

  it("never invents cards: a seat with only 1 hole card falls back to 2 backs", () => {
    const seats = [seat({ player_id: "a", seat_number: 1, hole_cards: ["Ah"] })];
    const html = renderToStaticMarkup(<LiveFelt seats={seats} {...baseProps} />);
    expect(seatCardCounts(html)).toEqual([2]);
  });

  it("fills the unrevealed board with 5 face-down V-logo backs (no empty slots)", () => {
    const html = renderToStaticMarkup(<LiveFelt seats={[]} {...baseProps} />);
    const board = boardSegment(html);
    expect((board.match(/data-testid="card-back"/g) || []).length).toBe(5);
    expect((board.match(/tracker-card-reveal/g) || []).length).toBe(0);
  });

  it("renders revealed board cards face-up and the rest as V backs", () => {
    const html = renderToStaticMarkup(
      <LiveFelt seats={[]} {...baseProps} displayCards={["Ah", "Kd", "Qc", "", ""]} />
    );
    const board = boardSegment(html);
    expect((board.match(/tracker-card-reveal/g) || []).length).toBe(3); // flop face-up
    expect((board.match(/data-testid="card-back"/g) || []).length).toBe(2); // turn+river backs
  });
});
