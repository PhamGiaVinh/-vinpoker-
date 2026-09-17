// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const { rpc, maybeSingle, voidState, handRow } = vi.hoisted(() => ({
  rpc: vi.fn(async () => ({ data: { ok: true }, error: null })),
  maybeSingle: vi.fn(async () => ({ data: handRow.value, error: null })),
  voidState: { value: false },
  handRow: { value: { id: "hand-1", is_voided: true } },
}));
const channel = { on: vi.fn(), subscribe: vi.fn() };
channel.on.mockReturnValue(channel);

vi.mock("@/integrations/supabase/SupabaseClientContext", () => {
  const client = {
    channel: () => channel,
    removeChannel: vi.fn(),
    rpc,
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }) }),
  };
  return { useSupabaseClient: () => client };
});

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
  useTrackerFloorAlertLocations: () => () => ({ tableNumber: 5, handNumber: 12, handVoided: voidState.value }),
}));

vi.mock("./HandHistoryWorkspace", () => ({
  HandHistoryWorkspace: ({ initialHandId }: { initialHandId: string }) => <p>{initialHandId} workspace sửa hand</p>,
}));

import { TrackerFloorAlertLane } from "./TrackerFloorAlertLane";

afterEach(() => { cleanup(); voidState.value = false; handRow.value.is_voided = true; rpc.mockClear(); maybeSingle.mockClear(); });

describe("TrackerFloorAlertLane", () => {
  it("opens the exact hand action history from a Floor alert deep link", async () => {
    render(
      <MemoryRouter initialEntries={["/ops/floor/tournaments/tournament-1/tables?club=club-1&alert=alert-1"]}>
        <TrackerFloorAlertLane tournamentId="tournament-1" />
      </MemoryRouter>,
    );

    expect(await screen.findByText("hand-1 workspace sửa hand")).toBeVisible();
    expect(screen.getByText(/Bàn 5 · Hand #12/)).toBeVisible();
  });

  it("only dismisses a voided hand after a fresh server check", async () => {
    voidState.value = true;
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<MemoryRouter><TrackerFloorAlertLane tournamentId="tournament-1" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /Hand đã void: đóng cảnh báo/i }));
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledWith("transition_tracker_floor_alert", expect.objectContaining({
      p_alert_id: "alert-1", p_expected_version: 1, p_transition: "dismiss",
    })));
    expect(maybeSingle).toHaveBeenCalledOnce();
    vi.mocked(window.confirm).mockRestore();
  });

  it("does not clear the alert when the server no longer confirms void", async () => {
    voidState.value = true;
    handRow.value.is_voided = false;
    render(<MemoryRouter><TrackerFloorAlertLane tournamentId="tournament-1" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /Hand đã void: đóng cảnh báo/i }));
    await vi.waitFor(() => expect(maybeSingle).toHaveBeenCalledOnce());
    expect(rpc).not.toHaveBeenCalled();
  });
});
