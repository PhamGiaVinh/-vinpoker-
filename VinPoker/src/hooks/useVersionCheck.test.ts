import { describe, expect, it } from "vitest";
import { isRemoteBuildNewer } from "./useVersionCheck";

describe("isRemoteBuildNewer", () => {
  it("flags a cached mobile bundle on its first check when the deployed build differs", () => {
    expect(isRemoteBuildNewer("old-build", "new-build")).toBe(true);
  });

  it("does not reload when the loaded bundle and deployed build match", () => {
    expect(isRemoteBuildNewer("current-build", "current-build")).toBe(false);
  });

  it("fails closed when either version marker is unavailable", () => {
    expect(isRemoteBuildNewer(null, "current-build")).toBe(false);
    expect(isRemoteBuildNewer("current-build", null)).toBe(false);
  });
});
