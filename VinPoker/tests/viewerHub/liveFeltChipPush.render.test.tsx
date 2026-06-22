// liveTableFx FX tripwires. The viewer passes two ADDITIVE props — `tableFx`
// (board-reveal stagger gate) and `chipPush` (a transient chip per distinct
// nonce). Operator / TV / replay never pass either, so their render must stay
// byte-identical. These tests pin:
//   P2-1  the flop stagger is gated by the PROP (not the global flag) — absent
//         the prop, board cards carry NO animation-delay (operator path intact).
//   P2-2  a chip fires on the FIRST action of a NEW hand: the composite nonce
//         (handNumber*10000+count) changes across the hand boundary and the
//         layer dedupes by "!== last", not "> last", so it is not skipped.
import { describe, it, expect, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { render, cleanup } from "@testing-library/react";
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

function boardSegment(html: string): string {
  const afterBoard = html.split('data-testid="board-cards"')[1] ?? "";
  return afterBoard.split('data-testid="seat-holecards"')[0] ?? "";
}

afterEach(() => cleanup());

describe("LiveFelt liveTableFx — board stagger is prop-gated (P2-1)", () => {
  const flop = { displayCards: ["Ah", "Kd", "Qc", "", ""] };

  it("WITHOUT tableFx (operator/TV/replay path) the flop carries no animation-delay", () => {
    const html = renderToStaticMarkup(<LiveFelt seats={[]} {...baseProps} {...flop} />);
    expect(boardSegment(html)).not.toContain("animation-delay");
  });

  it("WITH tableFx the flop's 3 cards stagger in (0/45/90ms), turn/river do not", () => {
    const html = renderToStaticMarkup(<LiveFelt seats={[]} {...baseProps} {...flop} tableFx />);
    const board = boardSegment(html);
    expect(board).toContain("animation-delay:45ms");
    expect(board).toContain("animation-delay:90ms");
    // only the 3 flop cards are staggered (i<3) — never a 4th/5th delay.
    expect((board.match(/animation-delay:/g) || []).length).toBe(3);
  });
});

describe("LiveFelt liveTableFx — chip-push (P2-2)", () => {
  const seats = [seat({ player_id: "a", seat_number: 1 }), seat({ player_id: "b", seat_number: 2 })];
  const chipCount = (el: HTMLElement) => el.querySelectorAll(".tracker-chip-push").length;

  it("fires one chip per DISTINCT nonce and survives the hand boundary; dedupes repeats", () => {
    // hand 1, action 30 → composite 1*10000+30
    const { container, rerender } = render(
      <LiveFelt seats={seats} {...baseProps} tableFx chipPush={null} />
    );
    expect(chipCount(container)).toBe(0); // null → nothing

    rerender(<LiveFelt seats={seats} {...baseProps} tableFx chipPush={{ seatNumber: 1, nonce: 10030 }} />);
    expect(chipCount(container)).toBe(1);

    // hand 2, action 1 → composite 2*10000+1 = 20001. Different nonce → fires
    // (the first action of the new hand is NOT skipped).
    rerender(<LiveFelt seats={seats} {...baseProps} handNumber={2} tableFx chipPush={{ seatNumber: 2, nonce: 20001 }} />);
    expect(chipCount(container)).toBe(2);

    // same nonce again (a re-render with no new action) → no extra chip.
    rerender(<LiveFelt seats={seats} {...baseProps} handNumber={2} tableFx chipPush={{ seatNumber: 2, nonce: 20001 }} />);
    expect(chipCount(container)).toBe(2);
  });

  it("respects prefers-reduced-motion: a new nonce enqueues no chip", () => {
    const prev = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: true, media: q, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      const { container, rerender } = render(<LiveFelt seats={seats} {...baseProps} tableFx chipPush={null} />);
      rerender(<LiveFelt seats={seats} {...baseProps} tableFx chipPush={{ seatNumber: 1, nonce: 10030 }} />);
      expect(chipCount(container)).toBe(0);
    } finally {
      window.matchMedia = prev;
    }
  });
});
