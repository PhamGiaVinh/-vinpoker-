// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const channel = { on: vi.fn(), subscribe: vi.fn() };
channel.on.mockReturnValue(channel);

vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({
  useSupabaseClient: () => ({
    channel: () => channel,
    removeChannel: vi.fn(),
  }),
}));

vi.mock("@/lib/tracker-floor-alerts/trackerFloorAlertsRead", () => ({
  listTrackerFloorAlerts: vi.fn(async () => ({
    ok: true,
    alerts: [{
      id: "alert-1",
      tournament_id: "tournament-1",
      tournament_table_id: "table-1",
      physical_table_id: "physical-1",
      hand_id: "hand-1",
      dealer_name: "Dealer",
      alert_kind: "wrong_action",
      priority: "urgent",
      status: "open",
      version: 1,
      correction_required: true,
      title: "Sai action",
      message: null,
      created_at: "2026-09-17T00:00:00Z",
    }],
  })),
}));

vi.mock("@/lib/tracker-floor-alerts/useTrackerFloorAlertLocations", () => ({
  useTrackerFloorAlertLocations: () => () => ({ tableNumber: 5, handNumber: 12 }),
}));

vi.mock("./FloorAlertHandReview", () => ({
  FloorAlertHandReview: ({ handId }: { handId: string }) => <p>{handId} chỉ xem</p>,
}));

import { TrackerFloorAlertLane } from "./TrackerFloorAlertLane";

afterEach(cleanup);

describe("TrackerFloorAlertLane", () => {
  it("opens Tracker with the tournament parameter required by the console", async () => {
    render(
      <MemoryRouter>
        <TrackerFloorAlertLane tournamentId="tournament-1" />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("link", { name: /Mở đúng bàn/i })).toHaveAttribute(
      "href",
      "/tracker/hand-input?tournament=tournament-1&table=physical-1&handId=hand-1",
    );
    expect(screen.getByText(/Bàn 5 · Hand #12/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Xem cả ván" }));
    expect(screen.getByText("hand-1 chỉ xem")).toBeVisible();
  });
});
