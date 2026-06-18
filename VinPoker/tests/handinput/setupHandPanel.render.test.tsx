import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SetupHandPanel } from "@/components/cashier/tournament-live/handinput/SetupHandPanel";
import type { RailSeat } from "@/components/cashier/tournament-live/handinput/SeatRail";

const noop = () => {};

// seats=[] keeps the SeatRail (and its own controls) out of the markup so the only
// `disabled` we can observe is the "Bắt đầu Hand" button — the assertion target.
const base = {
  seats: [] as RailSeat[],
  positions: new Map<number, string>(),
  buttonSeat: 1,
  onTapSeat: noop,
  onStartHand: noop,
  submitting: false,
  onVoid: noop,
};

describe("SetupHandPanel (engine setup step)", () => {
  it("disables 'Bắt đầu Hand' until the dealer button is confirmed", () => {
    const html = renderToStaticMarkup(
      <SetupHandPanel {...base} handNumber={5} buttonConfirmed={false} lastHandId={null} />
    );
    expect(html).toContain("Bắt đầu Hand");
    expect(html).toContain('disabled=""');
  });

  it("enables 'Bắt đầu Hand' once a hand number and the button are confirmed", () => {
    const html = renderToStaticMarkup(
      <SetupHandPanel {...base} handNumber={5} buttonConfirmed={true} lastHandId={null} />
    );
    expect(html).toContain("Bắt đầu Hand");
    expect(html).not.toContain('disabled=""');
  });

  it("offers Void Last Hand only when a previous hand exists", () => {
    const without = renderToStaticMarkup(
      <SetupHandPanel {...base} handNumber={5} buttonConfirmed={true} lastHandId={null} />
    );
    expect(without).not.toContain("Void Last Hand");

    const withLast = renderToStaticMarkup(
      <SetupHandPanel {...base} handNumber={5} buttonConfirmed={true} lastHandId="abcdef1234567890" />
    );
    expect(withLast).toContain("Void Last Hand (abcdef12)");
  });
});
