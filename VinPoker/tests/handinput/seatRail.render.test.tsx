import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SeatRail, type RailSeat } from "@/components/cashier/tournament-live/handinput/SeatRail";

const seats: RailSeat[] = [
  { player_id: "p1", seat_number: 1, display_name: "An", current_stack: 12000, current_bet: 0, avatar_url: "https://cdn.test/an.png" },
  { player_id: "p2", seat_number: 2, display_name: "Binh", current_stack: 8000, current_bet: 0 }, // no avatar → initials
];
const positions = new Map<number, string>([
  [1, "BTN"],
  [2, "BB"],
]);

describe("SeatRail (operator seat rail — avatar + dealer puck)", () => {
  it("renders an avatar image when avatar_url is present and initials otherwise", () => {
    const html = renderToStaticMarkup(
      <SeatRail seats={seats} positions={positions} buttonSeat={1} toActId={null} selectedActorId={null} onTapSeat={() => {}} />
    );
    expect(html).toContain('src="https://cdn.test/an.png"'); // p1 photo
    expect(html).toContain("BI"); // p2 initials fallback ("Binh" → "BI")
    expect(html).toContain("An");
    expect(html).toContain("Binh");
  });

  it("renders exactly one dealer 'D' puck, on the button seat", () => {
    const html = renderToStaticMarkup(
      <SeatRail seats={seats} positions={positions} buttonSeat={1} toActId={null} selectedActorId={null} onTapSeat={() => {}} />
    );
    expect(html).toContain('aria-label="Dealer"');
    expect((html.match(/aria-label="Dealer"/g) || []).length).toBe(1);
  });
});
