// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const query = {
  select: vi.fn(),
  in: vi.fn(),
  order: vi.fn(async () => ({
    data: [{ id: "alert-1", tournament_id: "tour-1", physical_table_id: "physical-5", hand_id: "hand-12", title: "Sai action", priority: "urgent", status: "open" }],
    error: null,
  })),
};
query.select.mockReturnValue(query);
query.in.mockReturnValue(query);

vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({
  useSupabaseClient: () => ({ from: () => query }),
}));

vi.mock("@/lib/tracker-floor-alerts/useTrackerFloorAlertLocations", () => ({
  useTrackerFloorAlertLocations: () => () => ({ tableNumber: 5, handNumber: 12 }),
}));

import { FloorVoiceAlertInbox } from "./FloorVoiceAlertInbox";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("FloorVoiceAlertInbox", () => {
  it("shows an open Tracker alert on the Floor landing and opens its tournament", async () => {
    const onSelect = vi.fn();
    render(<MemoryRouter><FloorVoiceAlertInbox tournaments={[{ id: "tour-1", name: "Giải TEST" }]} onSelect={onSelect} /></MemoryRouter>);

    expect(await screen.findByText(/Bàn 5 · Hand #12/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Sai action.*Bàn 5.*Hand #12.*Xem toàn bộ ván/i }));
    expect(onSelect).toHaveBeenCalledWith("tour-1", "alert-1");
  });
});
