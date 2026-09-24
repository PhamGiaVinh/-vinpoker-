export const TV_BRANDING_FONTS = ["display", "sans", "serif", "mono"] as const;
export type TvBrandingFont = (typeof TV_BRANDING_FONTS)[number];

export const TV_TEXT_STYLES = ["plain", "outline", "label"] as const;
export type TvTextStyle = (typeof TV_TEXT_STYLES)[number];

export interface TvBrandingTextBlock {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  font: TvBrandingFont;
  size: number;
  style: TvTextStyle;
}

export interface TvBrandingLayout {
  brandX: number;
  brandY: number;
  brandScale: number;
  logoScale: number;
  backgroundX: number;
  backgroundY: number;
  font: TvBrandingFont;
  textBlocks: TvBrandingTextBlock[];
}

export const LEGACY_TV_TEXT_ID = "00000000-0000-4000-8000-000000000001";

export function tvBrandingFontSize(size: number): string {
  return `${(size * 100 / 1920).toFixed(4)}cqw`;
}

export const DEFAULT_TV_BRANDING_LAYOUT: TvBrandingLayout = {
  brandX: 13,
  brandY: 10,
  brandScale: 70,
  logoScale: 80,
  backgroundX: 50,
  backgroundY: 50,
  font: "serif",
  textBlocks: [],
};

const SAFE = { left: 4, top: 4, right: 96, bottom: 96 };
const FIXED_REGIONS = [
  { left: 29, top: 24, right: 71, bottom: 76 }, // clock ring
  { left: 3, top: 16, right: 34, bottom: 84 }, // left stats and prize panels
  { left: 66, top: 16, right: 97, bottom: 84 }, // blinds and payout panels
] as const;
const BRAND_BOX = { width: 20, height: 12 };
const LEGACY_TEXT = { x: 38, y: 89, width: 24, height: 7 };

type Box = { left: number; top: number; right: number; bottom: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isBounded(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function isFont(value: unknown): value is TvBrandingFont {
  return typeof value === "string" && TV_BRANDING_FONTS.includes(value as TvBrandingFont);
}

function isTextStyle(value: unknown): value is TvTextStyle {
  return typeof value === "string" && TV_TEXT_STYLES.includes(value as TvTextStyle);
}

function intersects(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function insideSafeArea(box: Box): boolean {
  return box.left >= SAFE.left && box.top >= SAFE.top && box.right <= SAFE.right && box.bottom <= SAFE.bottom;
}

function clearOfFixedRegions(box: Box): boolean {
  return FIXED_REGIONS.every((region) => !intersects(box, region));
}

function textBox(block: Pick<TvBrandingTextBlock, "x" | "y" | "width" | "height">): Box {
  return {
    left: block.x - block.width / 2,
    top: block.y - block.height / 2,
    right: block.x + block.width / 2,
    bottom: block.y + block.height / 2,
  };
}

function brandBox(layout: Pick<TvBrandingLayout, "brandX" | "brandY" | "brandScale" | "logoScale">): Box {
  const width = BRAND_BOX.width * layout.brandScale / 100;
  const height = Math.max(BRAND_BOX.height, 9.6 * layout.logoScale / 100) * layout.brandScale / 100;
  return {
    left: layout.brandX - width / 2,
    top: layout.brandY - height / 2,
    right: layout.brandX + width / 2,
    bottom: layout.brandY + height / 2,
  };
}

export function validateTvBrandingLayout(layout: TvBrandingLayout): string | null {
  if (!isBounded(layout.brandX, 8, 92) || !isBounded(layout.brandY, 4, 96)
    || !isBounded(layout.brandScale, 70, 140) || !isBounded(layout.logoScale, 60, 150)
    || !isBounded(layout.backgroundX, 0, 100) || !isBounded(layout.backgroundY, 0, 100)
    || !isFont(layout.font)) {
    return "The logo, background, or font settings are outside the supported range.";
  }
  if (!insideSafeArea(brandBox(layout)) || !clearOfFixedRegions(brandBox(layout))) {
    return "The logo must stay in the safe area and clear of the clock, blinds, and stats.";
  }
  if (layout.textBlocks.length > 6) return "A layout can contain at most six text blocks.";
  const ids = new Set<string>();
  const boxes: Box[] = [];
  for (const block of layout.textBlocks) {
    if (!isUuid(block.id) || ids.has(block.id)) return "Each text block needs a unique stable ID.";
    ids.add(block.id);
    if (block.text.length > 100 || !block.text.trim()) return "Text blocks must contain 1–100 characters.";
    if (!isFont(block.font) || !isTextStyle(block.style) || !isBounded(block.size, 12, 42)
      || !isBounded(block.x, 4, 96) || !isBounded(block.y, 4, 96)
      || !isBounded(block.width, 8, 40) || !isBounded(block.height, 4, 12)) {
      return "A text block uses an unsupported font, style, size, or position.";
    }
    const box = textBox(block);
    if (!insideSafeArea(box) || !clearOfFixedRegions(box)) {
      return "Text blocks must stay in the safe area and clear of the clock, blinds, and stats.";
    }
    if (boxes.some((other) => intersects(box, other)) || intersects(box, brandBox(layout))) {
      return "Text blocks cannot overlap each other or the logo.";
    }
    boxes.push(box);
  }
  return null;
}

export function isTvBrandingLayoutValid(layout: TvBrandingLayout): boolean {
  return validateTvBrandingLayout(layout) === null;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseTextBlock(value: unknown): TvBrandingTextBlock | null {
  if (!isRecord(value)) return null;
  if (!isUuid(value.id) || typeof value.text !== "string" || !value.text.trim() || value.text.length > 100
    || !isBounded(value.x, 4, 96) || !isBounded(value.y, 4, 96)
    || !isBounded(value.width, 8, 40) || !isBounded(value.height, 4, 12)
    || !isFont(value.font) || !isBounded(value.size, 12, 42) || !isTextStyle(value.style)) return null;
  return {
    id: value.id,
    text: value.text,
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
    font: value.font,
    size: value.size,
    style: value.style,
  };
}

export function parseTvBrandingLayout(value: unknown): TvBrandingLayout {
  if (!isRecord(value)) return { ...DEFAULT_TV_BRANDING_LAYOUT, textBlocks: [] };
  const font = isFont(value.font) ? value.font : DEFAULT_TV_BRANDING_LAYOUT.font;
  const parsed: TvBrandingLayout = {
    brandX: isBounded(value.brand_x, 8, 92) ? value.brand_x : DEFAULT_TV_BRANDING_LAYOUT.brandX,
    brandY: isBounded(value.brand_y, 4, 96) ? value.brand_y : DEFAULT_TV_BRANDING_LAYOUT.brandY,
    brandScale: isBounded(value.brand_scale, 70, 140) ? value.brand_scale : DEFAULT_TV_BRANDING_LAYOUT.brandScale,
    logoScale: isBounded(value.logo_scale, 60, 150) ? value.logo_scale : DEFAULT_TV_BRANDING_LAYOUT.logoScale,
    backgroundX: isBounded(value.background_x, 0, 100) ? value.background_x : DEFAULT_TV_BRANDING_LAYOUT.backgroundX,
    backgroundY: isBounded(value.background_y, 0, 100) ? value.background_y : DEFAULT_TV_BRANDING_LAYOUT.backgroundY,
    font,
    textBlocks: [],
  };

  if (Array.isArray(value.text_blocks)) {
    parsed.textBlocks = value.text_blocks.slice(0, 6).map(parseTextBlock).filter((block): block is TvBrandingTextBlock => !!block);
  } else if (typeof value.custom_text === "string" && value.custom_text.trim()) {
    // v1 documents had one custom line. Keep it visible as a stable, editable v2 block.
    parsed.textBlocks = [{
      id: LEGACY_TV_TEXT_ID,
      text: value.custom_text.slice(0, 80),
      ...LEGACY_TEXT,
      font,
      size: 18,
      style: "plain",
    }];
  }
  return parsed;
}

export function serializeTvBrandingLayout(layout: TvBrandingLayout): Record<string, unknown> {
  return {
    brand_x: layout.brandX,
    brand_y: layout.brandY,
    brand_scale: layout.brandScale,
    logo_scale: layout.logoScale,
    background_x: layout.backgroundX,
    background_y: layout.backgroundY,
    font: layout.font,
    text_blocks: layout.textBlocks.map((block) => ({ ...block, text: block.text.trim() })),
  };
}

export const TV_BRANDING_FONT_STACKS: Record<TvBrandingFont, string> = {
  display: '"Arial Narrow", Impact, ui-sans-serif, sans-serif',
  sans: 'Inter, ui-sans-serif, system-ui, "Segoe UI", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "SFMono-Regular", Consolas, monospace',
};
