import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BetSizingChips } from "@/components/cashier/tournament-live/handinput/BetSizingChips";
import type { SizingContext } from "@/components/cashier/tournament-live/handinput/betSizing";

const noop = () => {};

function ctx(over: Partial<SizingContext> = {}): SizingContext {
  return {
    bigBlind: over.bigBlind ?? 100,
    pot: over.pot ?? 300,
    toCall: over.toCall ?? 0,
    actorCurrentBet: over.actorCurrentBet ?? 0,
    actorCurrentStack: over.actorCurrentStack ?? 10000,
  };
}

describe("BetSizingChips render", () => {
  it("renders the full chip row including 2.5BB/3BB when the big blind is known", () => {
    const html = renderToStaticMarkup(<BetSizingChips ctx={ctx()} value="" onChange={noop} />);
    expect(html).toContain("+BB");
    expect(html).toContain("2.5BB");
    expect(html).toContain("3BB");
    expect(html).toContain("Pot");
    expect(html).toContain("All-in");
  });

  it("hides the 2.5BB/3BB chips when the big blind is unknown", () => {
    const html = renderToStaticMarkup(<BetSizingChips ctx={ctx({ bigBlind: 0 })} value="" onChange={noop} />);
    expect(html).not.toContain("2.5BB");
    expect(html).not.toContain("3BB");
    // +BB / Pot / All-in still present
    expect(html).toContain("+BB");
    expect(html).toContain("Pot");
    expect(html).toContain("All-in");
  });

  it("disables every chip when disabled is set", () => {
    const html = renderToStaticMarkup(<BetSizingChips ctx={ctx()} value="" onChange={noop} disabled />);
    // Each chip button carries the disabled attribute.
    expect((html.match(/disabled/g) || []).length).toBeGreaterThanOrEqual(5);
  });
});
