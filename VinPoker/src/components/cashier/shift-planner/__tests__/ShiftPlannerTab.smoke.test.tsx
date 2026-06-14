import { describe, expect, it, beforeAll, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// The supabase client reads VITE_* env vars at import time (undefined in tests).
// Mock mode never calls it, so a stub keeps the import from throwing — mirrors
// the pattern in src/hooks/useTdAi.test.tsx.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import ShiftPlannerTab from "../../ShiftPlannerTab";

// jsdom gaps a few Radix/layout APIs rely on; stub them so the tree mounts.
beforeAll(() => {
  if (!(globalThis as any).ResizeObserver) {
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

describe("ShiftPlannerTab (smoke)", () => {
  it("renders the daily planner from mock data with assignments and no crash", async () => {
    render(
      <ShiftPlannerTab clubIds={["club-1"]} clubs={[{ id: "club-1", name: "CLB Demo" }]} />
    );

    // Header + key panels render (mock mode resolves on the first effect tick).
    expect(await screen.findByText("Xếp lịch dealer")).toBeInTheDocument();
    expect(await screen.findByText("Danh sách ca hôm nay")).toBeInTheDocument();
    expect(await screen.findByText("Coverage theo giờ")).toBeInTheDocument();
    expect(await screen.findByText("Tổng nhu cầu")).toBeInTheDocument();

    // The auto-fill draft produced assignment rows (ASCII-safe anchors): skill
    // badges from assigned dealers, the lead badge, and a shift group header.
    expect((await screen.findAllByText("Cash")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Tournament")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("16:00")).length).toBeGreaterThan(0);
  });
});
