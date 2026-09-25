import { describe, expect, it } from "vitest";
import {
  DEFAULT_TV_BRANDING_LAYOUT,
  LEGACY_TV_TEXT_ID,
  isTvBrandingLayoutValid,
  parseTvBrandingLayout,
  serializeTvBrandingLayout,
  tvBrandingFontSize,
  validateTvBrandingLayout,
  type TvBrandingTextBlock,
} from "./brandingLayout";

const block = (overrides: Partial<TvBrandingTextBlock> = {}): TvBrandingTextBlock => ({
  id: "7e9495b2-061d-4f07-9ee2-28c0a32db61f",
  text: "FINAL TABLE",
  x: 48,
  y: 90,
  width: 24,
  height: 6,
  font: "display",
  size: 24,
  style: "outline",
  ...overrides,
});

describe("TV branding layout", () => {
  it("scales text size from the 1920px branding canvas width", () => {
    expect(tvBrandingFontSize(18)).toBe("0.9375cqw");
    expect(tvBrandingFontSize(42)).toBe("2.1875cqw");
  });

  it("accepts and serializes the bounded multi-block server document", () => {
    const layout = { ...DEFAULT_TV_BRANDING_LAYOUT, textBlocks: [block()] };
    expect(isTvBrandingLayoutValid(layout)).toBe(true);
    expect(parseTvBrandingLayout(serializeTvBrandingLayout(layout))).toEqual(layout);
  });

  it("keeps a legacy custom_text document visible as a stable editable block", () => {
    const parsed = parseTvBrandingLayout({
      brand_x: 18,
      brand_y: 45,
      brand_scale: 100,
      logo_scale: 80,
      background_x: 50,
      background_y: 50,
      font: "serif",
      custom_text: "Final Table",
    });
    expect(parsed.textBlocks).toEqual([expect.objectContaining({
      id: LEGACY_TV_TEXT_ID,
      text: "Final Table",
      font: "serif",
    })]);
  });

  it("drops malformed text blocks and bounds the block count", () => {
    const parsed = parseTvBrandingLayout({
      text_blocks: [block(), { ...block(), id: "bad-id" }, ...Array.from({ length: 8 }, (_, i) => block({
        id: `7e9495b2-061d-4f07-9ee2-28c0a32db6${String(i).padStart(2, "0")}`,
      }))],
    });
    expect(parsed.textBlocks.length).toBeLessThanOrEqual(6);
  });

  it("validates the entire text box against safe bounds, fixed regions, and sibling boxes", () => {
    expect(validateTvBrandingLayout({ ...DEFAULT_TV_BRANDING_LAYOUT, textBlocks: [block({ x: 90, width: 20 })] }))
      .toMatch(/safe area/i);
    expect(validateTvBrandingLayout({ ...DEFAULT_TV_BRANDING_LAYOUT, textBlocks: [block({ x: 50, y: 50 })] }))
      .toMatch(/clock, blinds, and stats/i);
    expect(validateTvBrandingLayout({ ...DEFAULT_TV_BRANDING_LAYOUT, textBlocks: [block(), block({
      id: "8b7f5e3a-448d-4e8a-b4c7-0b35a5b2a441",
      x: 49,
    })] })).toMatch(/overlap/i);
  });

  it("rejects oversized logo bounds near the safe-area edge and invalid top-level scales", () => {
    expect(validateTvBrandingLayout({
      ...DEFAULT_TV_BRANDING_LAYOUT,
      brandY: 13.9,
      brandScale: 140,
      logoScale: 150,
    })).toMatch(/safe area/i);
    expect(validateTvBrandingLayout({ ...DEFAULT_TV_BRANDING_LAYOUT, logoScale: 151 }))
      .toMatch(/supported range/i);
    expect(validateTvBrandingLayout({ ...DEFAULT_TV_BRANDING_LAYOUT, backgroundX: 101 }))
      .toMatch(/supported range/i);
  });

  it("serializes only canonical v2 keys and never writes the legacy custom_text field", () => {
    const serialized = serializeTvBrandingLayout({ ...DEFAULT_TV_BRANDING_LAYOUT, textBlocks: [block()] });
    expect(serialized).toHaveProperty("text_blocks");
    expect(serialized).not.toHaveProperty("custom_text");
  });
});
