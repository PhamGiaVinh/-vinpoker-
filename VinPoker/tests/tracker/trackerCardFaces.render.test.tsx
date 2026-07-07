// C5 — xCards face deck (flag trackerCardFaces). Pins:
//  • flag OFF → PokerCard renders today's TEXT face byte-identical (cream card, rank+
//    suit spans, no <img>).
//  • flag ON → the FACE-UP card renders the xCards SVG (correct rank+suit filename,
//    ten = "T", glyph suits mapped), object-cover, no text spans.
//  • the HIDDEN back and the EMPTY slot are untouched by the flag (never an <img>).
//  • an unmapped card string still yields the text face (safe fallback).
import { describe, it, expect, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PokerCard } from "@/components/cashier/tournament-live/PokerVisuals";
import { FEATURES } from "@/lib/featureFlags";

afterEach(() => {
  (FEATURES as Record<string, unknown>).trackerCardFaces = false;
});

describe("PokerCard face — flag OFF (byte-identical text face)", () => {
  it("prop-flag OFF renders the cream text face, no image", () => {
    // Explicit OFF — the flag now ships ON, so this "OFF" case sets it rather than
    // relying on the module default (afterEach restores OFF for the rest).
    (FEATURES as Record<string, unknown>).trackerCardFaces = false;
    const html = renderToStaticMarkup(<PokerCard card="As" size="md" />);
    expect(html).toContain("bg-[#f7f0df]"); // cream card face
    expect(html).toContain("<span>A</span>"); // rank
    expect(html).toContain("♠"); // suit glyph
    expect(html).not.toContain("<img");
  });

  it("flipping the flag ON then OFF returns to the exact OFF markup", () => {
    (FEATURES as Record<string, unknown>).trackerCardFaces = false;
    const off1 = renderToStaticMarkup(<PokerCard card="Kh" size="sm" />);
    (FEATURES as Record<string, unknown>).trackerCardFaces = true;
    renderToStaticMarkup(<PokerCard card="Kh" size="sm" />);
    (FEATURES as Record<string, unknown>).trackerCardFaces = false;
    const off2 = renderToStaticMarkup(<PokerCard card="Kh" size="sm" />);
    expect(off2).toBe(off1);
  });
});

describe("PokerCard face — flag ON (xCards deck)", () => {
  const on = () => ((FEATURES as Record<string, unknown>).trackerCardFaces = true);

  it("renders the xCards SVG with the correct rank+suit filename", () => {
    on();
    const html = renderToStaticMarkup(<PokerCard card="As" size="md" />);
    expect(html).toContain('src="/cards/xcards/AS.svg"');
    expect(html).toContain("object-cover");
    expect(html).not.toContain("<span>A</span>"); // text face replaced
    expect(html).not.toContain("bg-[#f7f0df]");
  });

  it("maps ten to T, lowercase suits, and glyph suits", () => {
    on();
    expect(renderToStaticMarkup(<PokerCard card="Th" />)).toContain("/cards/xcards/TH.svg");
    expect(renderToStaticMarkup(<PokerCard card="2c" />)).toContain("/cards/xcards/2C.svg");
    expect(renderToStaticMarkup(<PokerCard card="Qd" />)).toContain("/cards/xcards/QD.svg");
    expect(renderToStaticMarkup(<PokerCard card="A♠" />)).toContain("/cards/xcards/AS.svg");
    expect(renderToStaticMarkup(<PokerCard card="10d" />)).toContain("/cards/xcards/TD.svg");
  });

  it("keeps muted → grayscale on the image face", () => {
    on();
    const html = renderToStaticMarkup(<PokerCard card="Js" muted />);
    expect(html).toContain("grayscale");
    expect(html).toContain("/cards/xcards/JS.svg");
  });

  it("an unmapped card string falls back to the text face (never a broken image)", () => {
    on();
    const html = renderToStaticMarkup(<PokerCard card="Zz" />);
    expect(html).not.toContain("<img");
    expect(html).toContain("<span>Z</span>"); // built-in text face
  });
});

describe("PokerCard non-face branches ignore the flag", () => {
  it("HIDDEN card never renders an xCards image (privacy invariant)", () => {
    (FEATURES as Record<string, unknown>).trackerCardFaces = true;
    const html = renderToStaticMarkup(<PokerCard card="As" hidden size="md" />);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("AS.svg");
  });

  it("EMPTY slot never renders an image", () => {
    (FEATURES as Record<string, unknown>).trackerCardFaces = true;
    const html = renderToStaticMarkup(<PokerCard card={null} size="md" />);
    expect(html).not.toContain("<img");
  });
});
