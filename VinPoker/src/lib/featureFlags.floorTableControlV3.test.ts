import { describe, expect, it } from "vitest";
import {
  isFloorTableControlV3PreviewEnabled,
  isFloorTableControlV3ProductionEnabled,
} from "./featureFlags";

describe("Floor Table Control V3 deployment gate", () => {
  it("enables only the matching Preview or Production pair", () => {
    expect(isFloorTableControlV3PreviewEnabled("preview", "preview")).toBe(true);
    expect(isFloorTableControlV3ProductionEnabled("production", "production")).toBe(true);
  });

  it("fails closed for mixed, truthy-looking, or missing values", () => {
    expect(isFloorTableControlV3PreviewEnabled("production", "preview")).toBe(false);
    expect(isFloorTableControlV3ProductionEnabled("preview", "production")).toBe(false);
    expect(isFloorTableControlV3ProductionEnabled(true, true)).toBe(false);
    expect(isFloorTableControlV3PreviewEnabled(undefined, undefined)).toBe(false);
  });
});
