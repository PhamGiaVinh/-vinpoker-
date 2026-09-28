import { describe, expect, it, vi } from "vitest";

import { listTrackerFloorAlerts } from "./trackerFloorAlertsRead";

describe("listTrackerFloorAlerts", () => {
  it("keeps a whole-hand Floor alert with nullable Dealer, assignment, and action fields", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        ok: true,
        alerts: [{
          id: "alert-1",
          tournament_id: "tournament-1",
          tournament_table_id: "table-1",
          physical_table_id: "physical-1",
          hand_id: "hand-1",
          dealer_id: null,
          assignment_id: null,
          dealer_name: null,
          alert_kind: "wrong_action",
          priority: "high",
          status: "open",
          version: 1,
          correction_required: true,
          title: "Báo sai hand",
          message: null,
          source_action_id: null,
          source_action_snapshot: null,
          source_state_fingerprint: "fingerprint",
          created_at: "2026-09-28T00:00:00Z",
        }],
      },
      error: null,
    }));

    const result = await listTrackerFloorAlerts({ rpc } as never, "tournament-1");

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    if (result.ok) {
      expect(result.alerts).toHaveLength(1);
      expect(result.alerts[0]).toEqual(expect.objectContaining({
        dealer_id: null,
        assignment_id: null,
        dealer_name: null,
        source_action_id: null,
      }));
    }
  });
});
