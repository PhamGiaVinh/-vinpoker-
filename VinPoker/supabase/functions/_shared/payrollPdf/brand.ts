import type { JsonRecord } from "./types.ts";

export const PAYROLL_PDF_RENDER_VERSION = "vinpoker-payroll-v1";
export const VINPOKER_PAYROLL_BRAND_V1_HASH = "e9ba119de7f679a0530cb565a677e73acaad4789f5c86cf96c40fbf14f1e86f3";

export interface PayrollBrandAsset {
  displayName: "VINPOKER";
  assetHash: string;
  primaryColor: { r: number; g: number; b: number };
  mutedColor: { r: number; g: number; b: number };
}

const BRAND_ASSETS: Record<string, Record<string, PayrollBrandAsset>> = {
  vinpoker: {
    v1: {
      displayName: "VINPOKER",
      assetHash: VINPOKER_PAYROLL_BRAND_V1_HASH,
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
  const snapshotHash = typeof clubSnapshot.brand_asset_hash === "string"
    ? clubSnapshot.brand_asset_hash
    : null;
  if (snapshotHash !== null && snapshotHash !== brand.assetHash) {
    throw new Error("PAYROLL_PDF_BRAND_ASSET_HASH_MISMATCH");
  }
  return brand;
}

