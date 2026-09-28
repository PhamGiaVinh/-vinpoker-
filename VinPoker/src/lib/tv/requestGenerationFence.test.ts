import { describe, expect, it } from "vitest";
import { createRequestGenerationFence } from "./requestGenerationFence";

describe("TV display admin request fence", () => {
  it("keeps club B after delayed club A resolves last", () => {
    const fence = createRequestGenerationFence();
    const clubA = fence.begin();
    const clubB = fence.begin();

    expect(fence.isCurrent(clubB)).toBe(true);
    expect(fence.isCurrent(clubA)).toBe(false);
  });

  it("invalidates an in-flight request when its owner unmounts", () => {
    const fence = createRequestGenerationFence();
    const request = fence.begin();
    fence.invalidate();
    expect(fence.isCurrent(request)).toBe(false);
  });
});
