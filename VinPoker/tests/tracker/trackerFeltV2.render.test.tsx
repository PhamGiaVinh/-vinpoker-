// C3 — felt UI v2 (flag trackerFeltV2). Pins:
//  • TrackerRacetrack: feltV2 absent === feltV2={false} (byte-identical); ON (rich) →
//    44px avatar (h-11), 2-line name clamp (no single-line ellipsis); non-rich ignores it.
//  • CardBack: flag OFF → today's guilloché (rosette ellipses); flag ON → the owner's
//    Sakura design (petal paths + lattice), SAME data-testid + size wrapper (the
//    card-back-counting tests elsewhere stay valid).
import { describe, it, expect, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TrackerRacetrack } from "@/components/tracker/TrackerRacetrack";
import { CardBack } from "@/components/cashier/tournament-live/PokerVisuals";
import { FEATURES } from "@/lib/featureFlags";
import type { SeatVM } from "@/components/tracker/types";

const SEATS: SeatVM[] = [
  { seatNumber: 1, name: "Nguyễn Văn Hoàng Long", position: "SB", stack: 19800, committed: 200 },
  { seatNumber: 5, name: "Binh", position: "BB", stack: 19600, committed: 400 },
];

const base = {
  seats: SEATS,
  actingSeatNumber: 5 as number | null,
  dealerSeatNumber: 1,
  boardCards: [] as string[],
  pot: 600,
  bigBlind: 400,
};

afterEach(() => {
  (FEATURES as Record<string, unknown>).trackerFeltV2 = false;
});

describe("TrackerRacetrack feltV2 gating (C3)", () => {
  it("feltV2 absent === feltV2={false} (byte-identical)", () => {
    const plain = renderToStaticMarkup(<TrackerRacetrack {...base} rich />);
    const off = renderToStaticMarkup(<TrackerRacetrack {...base} rich feltV2={false} />);
    expect(off).toBe(plain);
    expect(plain).toContain("h-8 w-8"); // 32px avatar today
    expect(plain).toContain("truncate"); // single-line name ellipsis today
  });

  it("feltV2 ON (rich): 44px avatar + 2-line name clamp, no single-line ellipsis on the name", () => {
    const html = renderToStaticMarkup(<TrackerRacetrack {...base} rich feltV2 />);
    expect(html).toContain("h-11 w-11"); // bigger avatar
    expect(html).toContain("line-clamp-2"); // full name on up to 2 lines
    expect(html).toContain("Nguyễn Văn Hoàng Long"); // the full name is in the DOM
  });

  it("feltV2 with NON-rich felt is ignored (plain pods keep today's markup)", () => {
    const off = renderToStaticMarkup(<TrackerRacetrack {...base} />);
    const on = renderToStaticMarkup(<TrackerRacetrack {...base} feltV2 />);
    expect(on).toBe(off);
  });

  it("feltV2 on PORTRAIT is ignored (a 390px oval can't fit nine 128px pods — measured)", () => {
    const off = renderToStaticMarkup(<TrackerRacetrack {...base} rich portrait />);
    const on = renderToStaticMarkup(<TrackerRacetrack {...base} rich portrait feltV2 />);
    expect(on).toBe(off);
  });
});

describe("CardBack Sakura gating (C3)", () => {
  it("flag OFF → today's guilloché back (rosette ellipses, no petal path), testid preserved", () => {
    // Explicit OFF — the flag now ships ON, so this "OFF" case sets it rather than
    // relying on the module default (afterEach restores OFF for the rest).
    (FEATURES as Record<string, unknown>).trackerFeltV2 = false;
    const html = renderToStaticMarkup(<CardBack size="md" />);
    expect(html).toContain('data-testid="card-back"');
    expect(html).toContain("<ellipse"); // the guilloché rosette
    expect(html).not.toContain("C -15.0 -21.0"); // no sakura petal
  });

  it("flag ON → the Sakura back (petal paths + 45° lattice), SAME testid + wrapper", () => {
    (FEATURES as Record<string, unknown>).trackerFeltV2 = true;
    const html = renderToStaticMarkup(<CardBack size="md" />);
    expect(html).toContain('data-testid="card-back"');
    expect(html).toContain("C -15.0 -21.0"); // sakura petal path
    expect(html).toContain('patternTransform="rotate(45)"'); // the wine lattice
    expect(html).not.toContain("<ellipse"); // guilloché gone under the flag
    expect(html).toContain("h-16 w-12"); // md size wrapper preserved
  });

  it("flag ON tiny sizes (xs) drop the radial ticks but keep the center sakura", () => {
    (FEATURES as Record<string, unknown>).trackerFeltV2 = true;
    const html = renderToStaticMarkup(<CardBack size="xs" />);
    expect(html).toContain("C -15.0 -21.0"); // center flower still there
    expect(html).not.toContain("<line "); // no tick marks at tiny sizes (note: "<line " ≠ "<linearGradient")
  });
});
