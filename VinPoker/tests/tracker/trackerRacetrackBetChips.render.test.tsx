// liveBetChips + trackerFeltDealerFix — TrackerRacetrack additive props. Pins:
//  • betChips absent === betChips={false} === today's TEXT puck (byte-identical);
//    betChips ON → a ChipStack DISC (the `tracker-bet-pulse` recipe) with the amount.
//  • dealerFix absent === dealerFix={false} (byte-identical); ON changes the cue placement
//    (merged into the dealer block) but still shows the "Tracker đứng đây" cue.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TrackerRacetrack } from "@/components/tracker/TrackerRacetrack";
import type { SeatVM } from "@/components/tracker/types";

const SEATS: SeatVM[] = [
  { seatNumber: 1, name: "An", position: "SB", stack: 19800, committed: 200 },
  { seatNumber: 2, name: "Binh", position: "BB", stack: 19600, committed: 400 },
];

const base = {
  seats: SEATS,
  actingSeatNumber: 2 as number | null,
  dealerSeatNumber: 1,
  boardCards: [] as string[],
  pot: 600,
  bigBlind: 400,
};

describe("TrackerRacetrack liveBetChips + dealerFix gating", () => {
  it("betChips absent === betChips={false} (byte-identical text puck, no disc)", () => {
    const plain = renderToStaticMarkup(<TrackerRacetrack {...base} />);
    const off = renderToStaticMarkup(<TrackerRacetrack {...base} betChips={false} />);
    expect(off).toBe(plain);
    // OFF = the committed amount as a plain text puck; NONE of the ChipStack disc recipe.
    expect(plain).toContain("200");
    expect(plain).not.toContain("tracker-bet-pulse");
  });

  it("betChips ON renders a ChipStack disc (tracker-bet-pulse) with each committed amount", () => {
    const html = renderToStaticMarkup(<TrackerRacetrack {...base} betChips />);
    expect(html).toContain("tracker-bet-pulse"); // the ChipStack disc pile
    expect(html).toContain("200"); // seat 1 committed
    expect(html).toContain("400"); // seat 2 committed
  });

  it("dealerFix absent === dealerFix={false} (byte-identical); ON moves the cue but keeps it", () => {
    const plain = renderToStaticMarkup(<TrackerRacetrack {...base} />);
    const off = renderToStaticMarkup(<TrackerRacetrack {...base} dealerFix={false} />);
    expect(off).toBe(plain);
    const on = renderToStaticMarkup(<TrackerRacetrack {...base} dealerFix />);
    expect(on).not.toBe(plain); // geometry/cue placement changed
    expect(on).toContain("Tracker đứng đây"); // the cue text is still present
  });
});
