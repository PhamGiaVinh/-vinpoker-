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

  // A1a: in RICH mode the top-row pods (4/5/6) carry hole-card backs above the pod and
  // overflow the oval's top rim → dealerFix nudges them DOWN. Non-rich never clips, so
  // the nudge is rich-only. SSR renders landscape (portrait defaults false): seat 5
  // top 9→16, seats 4/6 top 12→17.
  const TOP_SEATS: SeatVM[] = [
    { seatNumber: 4, name: "D", stack: 100, committed: 0 },
    { seatNumber: 5, name: "E", stack: 100, committed: 0 },
    { seatNumber: 6, name: "F", stack: 100, committed: 0 },
  ];

  it("rich + dealerFix nudges the top row (4/5/6) DOWN off the clipped top rim", () => {
    const off = renderToStaticMarkup(<TrackerRacetrack {...base} seats={TOP_SEATS} rich />);
    const on = renderToStaticMarkup(<TrackerRacetrack {...base} seats={TOP_SEATS} rich dealerFix />);
    expect(off).toContain("top:9%"); // seat 5 un-nudged (landscape anchor)
    expect(on).not.toContain("top:9%");
    expect(on).toContain("top:16%"); // seat 5 nudged down +7
    expect(on).toContain("top:17%"); // seats 4/6 nudged down +5
  });

  it("NON-rich dealerFix leaves the top row untouched (short pods never clip)", () => {
    const off = renderToStaticMarkup(<TrackerRacetrack {...base} seats={TOP_SEATS} />);
    const on = renderToStaticMarkup(<TrackerRacetrack {...base} seats={TOP_SEATS} dealerFix />);
    // seat 5 stays at its landscape anchor top:9% in BOTH (no rich → no top-row nudge)
    expect(off).toContain("top:9%");
    expect(on).toContain("top:9%");
    expect(on).not.toContain("top:16%");
  });
});
