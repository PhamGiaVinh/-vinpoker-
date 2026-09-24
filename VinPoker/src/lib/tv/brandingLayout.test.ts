import { describe, expect, it } from "vitest";
import {
  DEFAULT_TV_BRANDING_LAYOUT,
  parseTvBrandingLayout,
  serializeTvBrandingLayout,
} from "./brandingLayout";

describe("TV branding layout", () => {
  it("accepts a complete safe server document", () => {
    expect(parseTvBrandingLayout({
      brand_x: 72,
      brand_y: 30,
      brand_scale: 120,
      logo_scale: 135,
      background_x: 25,
      background_y: 80,
      font: "display",
      custom_text: "Final Table",
    })).toEqual({
      brandX: 72,
      brandY: 30,
      brandScale: 120,
      logoScale: 135,
      backgroundX: 25,
      backgroundY: 80,
      font: "display",
      customText: "Final Table",
    });
  });

  it("falls back field-by-field for malformed or out-of-range values", () => {
    expect(parseTvBrandingLayout({
      brand_x: -1,
      brand_y: "50",
      brand_scale: Number.POSITIVE_INFINITY,
      logo_scale: 151,
      background_x: 101,
      background_y: null,
      font: "url(javascript:bad)",
      custom_text: 42,
    })).toEqual(DEFAULT_TV_BRANDING_LAYOUT);
  });

  it("serializes only the supported server keys and trims custom text", () => {
    expect(serializeTvBrandingLayout({ ...DEFAULT_TV_BRANDING_LAYOUT, customText: "  Live now  " }))
      .toEqual({
        brand_x: 18,
        brand_y: 45,
        brand_scale: 100,
        logo_scale: 80,
        background_x: 50,
        background_y: 50,
        font: "serif",
        custom_text: "Live now",
      });
  });
});
