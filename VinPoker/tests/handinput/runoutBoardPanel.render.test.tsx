// B2 — all-in runout ONE-SCREEN panel. Pins: shows EVERY remaining board slot at
// once + a single "Chia hết bài"; slots already persisted to the viewer are LOCKED
// (rendered as read-only cards, not pickers); the deal-all button stays disabled
// until every remaining slot is filled. A runout that starts on the turn (flop
// already live) shows only the turn+river slots as editable.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RunoutBoardPanel } from "@/components/cashier/tournament-live/handinput/RunoutBoardPanel";
import type { Card } from "@/components/shared/CardSlotPicker";

const noop = () => {};
const empty: (Card | null)[] = [null, null, null, null, null];
const allFilled: (Card | null)[] = ["As", "Kh", "Td", "2c", "9d"];
const turnRunout: (Card | null)[] = ["As", "Kh", "Td", null, null]; // flop already live

describe("RunoutBoardPanel (B2 one-screen runout)", () => {
  it("nothing dealt yet: header + all five slots editable, Chia hết bài disabled until filled", () => {
    const html = renderToStaticMarkup(
      <RunoutBoardPanel
        communityCards={empty}
        persistedBoardCount={0}
        usedCards={new Set()}
        onCardChange={noop}
        onDealAll={noop}
      />
    );
    expect(html).toContain("Chia hết bài (all-in)");
    expect(html).toContain("Chia hết bài"); // the button
    expect(html).toContain("Flop");
    expect(html).toContain("Turn");
    expect(html).toContain("River");
    expect(html).toContain('disabled=""'); // deal-all disabled while empty
  });

  it("all five filled → Chia hết bài enabled", () => {
    const html = renderToStaticMarkup(
      <RunoutBoardPanel
        communityCards={allFilled}
        persistedBoardCount={0}
        usedCards={new Set()}
        onCardChange={noop}
        onDealAll={noop}
      />
    );
    expect(html).not.toContain('disabled=""');
  });

  it("runout starting on the turn: the live flop is LOCKED (shown, not a picker); only turn+river editable", () => {
    const html = renderToStaticMarkup(
      <RunoutBoardPanel
        communityCards={turnRunout}
        persistedBoardCount={3}
        usedCards={new Set()}
        onCardChange={noop}
        onDealAll={noop}
      />
    );
    // The persisted flop cards render as read-only text (locked slots).
    expect(html).toContain("As");
    expect(html).toContain("Kh");
    expect(html).toContain("Td");
    // Two undealt slots remain → deal-all disabled until they're filled.
    expect(html).toContain('disabled=""');
  });

  it("submitting locks the deal-all button", () => {
    const html = renderToStaticMarkup(
      <RunoutBoardPanel
        communityCards={allFilled}
        persistedBoardCount={0}
        usedCards={new Set()}
        onCardChange={noop}
        onDealAll={noop}
        submitting
      />
    );
    expect(html).toContain('disabled=""');
  });

  // A0 review fix: while the staged deal-all is in flight, the remaining slots are
  // FROZEN — a mid-flight edit would show locally (and be used by settle) while the
  // viewer received the stale card from the press-time closure.
  it("submitting freezes the remaining card slots (pointer-events-none wrapper)", () => {
    const idle = renderToStaticMarkup(
      <RunoutBoardPanel
        communityCards={allFilled}
        persistedBoardCount={0}
        usedCards={new Set()}
        onCardChange={noop}
        onDealAll={noop}
      />
    );
    expect(idle).not.toContain("pointer-events-none");
    const busy = renderToStaticMarkup(
      <RunoutBoardPanel
        communityCards={allFilled}
        persistedBoardCount={0}
        usedCards={new Set()}
        onCardChange={noop}
        onDealAll={noop}
        submitting
      />
    );
    expect((busy.match(/pointer-events-none/g) || []).length).toBe(5); // all 5 undealt slots frozen
  });
});
