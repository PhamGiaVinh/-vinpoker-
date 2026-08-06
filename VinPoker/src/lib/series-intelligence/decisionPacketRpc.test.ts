import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import { getDecisionEventState, promoteNativeEventActual, reconcileEventActual } from "./decisionPacketRpc";

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
});
