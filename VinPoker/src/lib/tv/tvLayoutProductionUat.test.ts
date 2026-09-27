import { describe, expect, it } from "vitest";
import { FEATURES } from "@/lib/featureFlags";

describe("TV layout production UAT build gate", () => {
  it("ships the editor reader path while server authorization remains authoritative", () => {
    expect(FEATURES.tvLayoutEditorV1).toBe(true);
  });
});
