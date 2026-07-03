// trackerShowdownRevealOrder (LiveFelt `revealOrder`/`revealStaggerMs`) — the viewer
// staggers each showing seat's hole-card flip by its place in the reveal order.
// Pins: absent → no animationDelay (simultaneous, byte-identical); present → seat i
// gets animationDelay i*staggerMs (index 0 = none); face-down (unrevealed) seats never
// get a delay; a seat not in the order gets none.
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
// three showing seats
const shown = [
  seat({ player_id: "a", seat_number: 1, hole_cards: ["Kh", "3h"] }),
  seat({ player_id: "b", seat_number: 3, hole_cards: ["7s", "4s"] }),
  seat({ player_id: "c", seat_number: 5, hole_cards: ["As", "Ad"] }),
];
const delaysFor = (html: string) => (html.match(/animation-delay:\s*([0-9]+)ms/g) || []);

describe("LiveFelt showdown reveal-order stagger", () => {
  it("revealOrder absent → NO animation-delay on hole cards (byte-identical)", () => {
    const html = renderToStaticMarkup(<LiveFelt seats={shown} {...baseProps} />);
    expect(html).not.toContain("animation-delay");
  });

  it("revealOrder present → each seat delayed by its index × stagger (index 0 → none)", () => {
    // Order c(5) first, then a(1), then b(3) — e.g. seat 5 was the river bettor.
    const html = renderToStaticMarkup(
      <LiveFelt seats={shown} {...baseProps} revealOrder={["c", "a", "b"]} revealStaggerMs={500} />
    );
    // c = index 0 → no delay; a = index 1 → 500ms (×2 cards); b = index 2 → 1000ms (×2).
    const delays = delaysFor(html);
    expect(delays.filter((d) => /500ms/.test(d)).length).toBe(2);
    expect(delays.filter((d) => /1000ms/.test(d)).length).toBe(2);
    // c (first) has no delay style at all.
    expect(delays.filter((d) => /:\s*0ms/.test(d)).length).toBe(0);
  });

  it("a seat NOT in revealOrder gets no delay; face-down seats never get one", () => {
    const seats = [
      seat({ player_id: "a", seat_number: 1, hole_cards: ["Kh", "3h"] }),
      seat({ player_id: "z", seat_number: 9 }), // face-down (no hole cards)
    ];
    const html = renderToStaticMarkup(
      <LiveFelt seats={seats} {...baseProps} revealOrder={["a"]} revealStaggerMs={500} />
    );
    // Only 'a' is in the order at index 0 → no delay; 'z' has no revealed cards.
    expect(html).not.toContain("animation-delay");
  });

  it("stagger respects a custom revealStaggerMs", () => {
    const html = renderToStaticMarkup(
      <LiveFelt seats={shown} {...baseProps} revealOrder={["a", "b", "c"]} revealStaggerMs={300} />
    );
    expect(delaysFor(html).filter((d) => /300ms/.test(d)).length).toBe(2); // b at index 1
    expect(delaysFor(html).filter((d) => /600ms/.test(d)).length).toBe(2); // c at index 2
  });
});
