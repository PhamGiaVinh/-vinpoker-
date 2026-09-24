export const TV_BRANDING_FONTS = ["display", "sans", "serif", "mono"] as const;
export type TvBrandingFont = (typeof TV_BRANDING_FONTS)[number];

export interface TvBrandingLayout {
  brandX: number;
  brandY: number;
  brandScale: number;
  logoScale: number;
  backgroundX: number;
  backgroundY: number;
  font: TvBrandingFont;
  customText: string;
}

export const DEFAULT_TV_BRANDING_LAYOUT: TvBrandingLayout = {
  brandX: 18,
  brandY: 45,
  brandScale: 100,
  logoScale: 80,
  backgroundX: 50,
  backgroundY: 50,
  font: "serif",
  customText: "",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

function boundedNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback;
}

export function parseTvBrandingLayout(value: unknown): TvBrandingLayout {
  if (!isRecord(value)) return { ...DEFAULT_TV_BRANDING_LAYOUT };
  const font = typeof value.font === "string" && TV_BRANDING_FONTS.includes(value.font as TvBrandingFont)
    ? value.font as TvBrandingFont
    : DEFAULT_TV_BRANDING_LAYOUT.font;
  return {
    brandX: boundedNumber(value.brand_x, 8, 92, DEFAULT_TV_BRANDING_LAYOUT.brandX),
    brandY: boundedNumber(value.brand_y, 15, 85, DEFAULT_TV_BRANDING_LAYOUT.brandY),
    brandScale: boundedNumber(value.brand_scale, 70, 140, DEFAULT_TV_BRANDING_LAYOUT.brandScale),
    logoScale: boundedNumber(value.logo_scale, 60, 150, DEFAULT_TV_BRANDING_LAYOUT.logoScale),
    backgroundX: boundedNumber(value.background_x, 0, 100, DEFAULT_TV_BRANDING_LAYOUT.backgroundX),
    backgroundY: boundedNumber(value.background_y, 0, 100, DEFAULT_TV_BRANDING_LAYOUT.backgroundY),
    font,
    customText: typeof value.custom_text === "string" ? value.custom_text.slice(0, 80) : "",
  };
}

export function serializeTvBrandingLayout(layout: TvBrandingLayout): Record<string, string | number> {
  return {
    brand_x: layout.brandX,
    brand_y: layout.brandY,
    brand_scale: layout.brandScale,
    logo_scale: layout.logoScale,
    background_x: layout.backgroundX,
    background_y: layout.backgroundY,
    font: layout.font,
    custom_text: layout.customText.trim(),
  };
}

export const TV_BRANDING_FONT_STACKS: Record<TvBrandingFont, string> = {
  display: '"Arial Narrow", Impact, ui-sans-serif, sans-serif',
  sans: 'Inter, ui-sans-serif, system-ui, "Segoe UI", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "SFMono-Regular", Consolas, monospace',
};
