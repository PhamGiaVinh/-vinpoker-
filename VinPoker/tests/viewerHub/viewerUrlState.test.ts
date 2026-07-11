import { describe, expect, it } from "vitest";
import { panelToViewerTab, parseViewerTab, viewerTabToPanel } from "@/components/cashier/tournament-live/viewer-hub/viewerUrlState";

describe("viewer URL state", () => {
  it("accepts only known public tabs", () => {
    expect(parseViewerTab("updates")).toBe("updates");
    expect(parseViewerTab("hands")).toBe("hands");
    expect(parseViewerTab("admin")).toBe("updates");
    expect(parseViewerTab(null, "photos")).toBe("photos");
  });

  it("maps the public hands slug to the existing history panel", () => {
    expect(viewerTabToPanel("hands")).toBe("history");
    expect(panelToViewerTab("history")).toBe("hands");
    expect(panelToViewerTab("structure")).toBe("structure");
  });
});
