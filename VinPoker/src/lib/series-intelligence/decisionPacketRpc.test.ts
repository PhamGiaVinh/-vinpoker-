import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import {
  createDecisionPacket,
  freezeDecisionPacket,
  getDecisionEventState,
  promoteNativeEventActual,
  reconcileEventActual,
  recordEventActual,
} from "./decisionPacketRpc";

describe("D2B explicit RPC boundary", () => {
  beforeEach(() => rpc.mockReset());

  it("uses only exact named argument objects and fails closed for malformed mutations", async () => {
    rpc.mockResolvedValue({ data: { version: "series-decision-event-state-v1", state: "created" }, error: null });
    await expect(promoteNativeEventActual({ eventId: "event", idempotencyKey: "native:0001" })).resolves.toMatchObject({ ok: true });
    expect(rpc).toHaveBeenLastCalledWith("series_promote_native_event_actual_v1", { p_event_id: "event", p_idempotency_key: "native:0001" });
    rpc.mockResolvedValue({ data: { state: "created" }, error: null });
    await expect(reconcileEventActual({ autoRevisionId: "auto", manualRevisionId: "manual", resolution: { mode: "blocked_conflict", blockReasons: ["missing"] }, reason: "No safe resolution", idempotencyKey: "reconcile:0001" })).resolves.toEqual({ ok: false, error: "malformed_response" });
  });

  it("classifies absent backend separately from normal RPC failure", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find function" } });
    await expect(getDecisionEventState("event")).resolves.toEqual({ ok: false, error: "backend_unavailable" });
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "forbidden" } });
    await expect(getDecisionEventState("event")).resolves.toEqual({ ok: false, error: "rpc_error" });
  });

  it("uses the exact D2A create and freeze RPC contracts", async () => {
    rpc.mockResolvedValue({ data: { id: "packet", schema_version: "series-decision-packet-v1" }, error: null });
    await expect(createDecisionPacket({
      eventId: "22222222-2222-4222-8222-222222222222",
      horizon: "T-7",
      targetMetric: "entries",
      asOfTs: "2026-08-01T03:00:00.000Z",
      sourceCutoff: "2026-08-01T02:59:00.000Z",
      targetEventTs: "2026-08-08T03:00:00.000Z",
      forecastSnapshotId: null,
      forecastState: "no_forecast_available",
      manualExpectation: null,
      publicEvidence: [],
      registrationSlice: null,
      campaignSlice: null,
      knownInformation: {},
      recommendedAction: null,
      ownerDecision: null,
      publicAction: null,
      decisionReason: "Record the pre-event decision context.",
      alternatives: [],
      assumptions: [],
      uncertaintyNotes: null,
      supersedesPacketId: null,
      correctionReason: null,
      idempotencyKey: "packet:test-0001",
    })).resolves.toMatchObject({ ok: true });
    expect(rpc).toHaveBeenLastCalledWith("series_create_decision_packet_v1", expect.objectContaining({
      p_event_id: "22222222-2222-4222-8222-222222222222",
      p_decision_horizon: "T-7",
      p_target_metric: "entries",
      p_idempotency_key: "packet:test-0001",
    }));

    await expect(freezeDecisionPacket({ packetId: "packet", expectedDraftVersion: 1 })).resolves.toMatchObject({ ok: true });
    expect(rpc).toHaveBeenLastCalledWith("series_freeze_decision_packet_v1", {
      p_packet_id: "packet",
      p_expected_draft_version: 1,
    });
  });

  it("maps the complete manual actual payload without inventing missing metrics", async () => {
    rpc.mockResolvedValue({ data: { id: "actual", schema_version: "series-event-actual-revision-v1" }, error: null });
    const missingCount = { availability: "missing" as const, value: null };
    const missingMoney = { availability: "missing" as const, amountMinor: null, currency: null, scale: null };
    await expect(recordEventActual({
      eventId: "22222222-2222-4222-8222-222222222222",
      scope: "event_total",
      finality: "final",
      sourceTimestampState: "not_reported",
      sourceTimestamp: null,
      metrics: {
        entries: { availability: "present", value: 100 },
        uniquePlayers: missingCount,
        totalBullets: missingCount,
        reentries: missingCount,
        registrationRecords: missingCount,
        paidPlaces: missingCount,
        prizePool: missingMoney,
        overlay: missingMoney,
      },
      supersedesRevisionId: null,
      idempotencyKey: "actual:test-0001",
      correctionReason: null,
    })).resolves.toMatchObject({ ok: true });
    expect(rpc).toHaveBeenLastCalledWith("series_record_event_actual_v1", expect.objectContaining({
      p_event_id: "22222222-2222-4222-8222-222222222222",
      p_entries_availability: "present",
      p_entries_value: 100,
      p_unique_players_availability: "missing",
      p_unique_players_value: null,
      p_prize_pool_availability: "missing",
      p_prize_pool_amount_minor: null,
    }));
  });
});
