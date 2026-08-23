import type { JsonRecord } from "./types.ts";

export const PAYROLL_PDF_RENDER_VERSION = "vinpoker-payroll-v1";

export interface PayrollBrandAsset {
  displayName: "VINPOKER";
  primaryColor: { r: number; g: number; b: number };
  mutedColor: { r: number; g: number; b: number };
}

const BRAND_ASSETS: Record<string, Record<string, PayrollBrandAsset>> = {
  vinpoker: {
    v1: {
      displayName: "VINPOKER",
      primaryColor: { r: 0.075, g: 0.42, b: 0.23 },
      mutedColor: { r: 0.91, g: 0.96, b: 0.92 },
    },
  },
};

export function resolvePayrollBrand(clubSnapshot: JsonRecord): PayrollBrandAsset {
  const brandKey = typeof clubSnapshot.brand_key === "string" ? clubSnapshot.brand_key : "";
  const version = typeof clubSnapshot.brand_asset_version === "string"
    ? clubSnapshot.brand_asset_version
    : "";
  const brand = BRAND_ASSETS[brandKey]?.[version];
  if (!brand) throw new Error("PAYROLL_PDF_BRAND_ASSET_UNAVAILABLE");
  return brand;
}

