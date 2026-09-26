import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => {
  const rpc = vi.fn();
  return { rpc, client: { rpc } };
});
vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({ useSupabaseClient: () => h.client }));
import { MultiDayFloorEventPanel } from "./MultiDayFloorEventPanel";

const eventId = "30000000-0000-0000-0000-00000000000a";
const playerId = "60000000-0000-0000-0000-000000000021";
const participationId = "f334cb4d-fc1c-4f55-8da7-e98780e74f60";
const read = {
  releaseEnabled: true, eventItmPercent: 10,
  capabilities: { canFinalizePayout: true, canRequestAdjustment: true, canApproveAdjustment: true },
  rules: { policy: "SUM_STACKS", itmPercent: 10, day2Percent: 20, minCashX: 1.5 },
  qualification: { sourceHash: "a".repeat(32), participationCount: 1, lockedAt: "now" },
  finalization: null,
  correctionRequests: [],
};
const qualification = { state: "LOCKED", sourceHash: "a".repeat(32), policy: "SUM_STACKS",
  flights: [{ flightId: "flight-one", status: "locked", dayStatus: "locked", validEntries: 33,
    itmTarget: 4, day2Target: 7, eligibleBags: [] }] };
const payout = { state: "READY", rulesVersion: "a".repeat(32), fundingRevision: "b".repeat(32),
  qualificationRevision: "c".repeat(32), payoutInputHash: "d".repeat(32),
  directPoolVnd: 1_000_000, transferPoolVnd: 6_000_000, feesVnd: 600_000,
  recordedOverlayVnd: 500_000, requiredShortfallVnd: 0, paidPlayerVnd: 100_000,
  unpaidObligationVnd: 7_000_000, clubRetainedTieVnd: 400, unallocatedPoolVnd: 399_600,
  obligations: [{ playerId, participationId, totalVnd: 1_000_000, paidVnd: 100_000, unpaidVnd: 900_000 }],
  sourceSnapshot: { payments: [{ id: "payment-id", playerId, amountVnd: 100_000 }] },
};

beforeEach(() => {
  h.rpc.mockReset();
  h.rpc.mockImplementation(async (name: string) => ({ data: name === "multi_day_floor_read_v1" ? read
    : name === "multi_day_qualification_preview_v1" ? qualification
      : name === "multi_day_payout_preview_v1" ? payout : { ok: true }, error: null }));
  vi.stubGlobal("crypto", { randomUUID: () => "request-id" });
});
afterEach(cleanup);

describe("verified Multi-day Floor panel", () => {
  it("locks server rules before entries and uses the policy/min-cash RPC", async () => {
    let configured = false;
    h.rpc.mockImplementation(async (name: string) => {
      if (name === "multi_day_floor_read_v1") return { data: configured ? read : { ...read, rules: null, qualification: null }, error: null };
      if (name === "multi_day_set_qualification_rules_v2") { configured = true; return { data: { ok: true }, error: null }; }
      return { data: qualification, error: null };
    });
    render(<MultiDayFloorEventPanel eventId={eventId} />);
    fireEvent.change(await screen.findByLabelText("Bag selection policy"), { target: { value: "SUM_STACKS" } });
    fireEvent.change(screen.getByLabelText("Minimum cash multiplier"), { target: { value: "1.5" } });
    fireEvent.change(screen.getByLabelText("Day2 % per flight"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Lock rules" }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("multi_day_set_qualification_rules_v2", {
      p_event_id: eventId, p_policy: "SUM_STACKS", p_min_cash_x: 1.5, p_day2_percent: 20,
    }));
    await screen.findByText(/Rules locked before the first registration/);
  });

  it("shows server flight target, source categories, fees and revisions without treating shortfall as overlay", async () => {
    const { rerender } = render(<MultiDayFloorEventPanel eventId={eventId} />);
    await screen.findByText(/Flight flight-o/);
    expect(screen.getByText(/33 valid entries → ITM 4 · Day2 target 7/)).toBeTruthy();
    expect(screen.getByText(/ITM: 10% · Day2: 20% per flight/)).toBeTruthy();
    rerender(<MultiDayFloorEventPanel eventId={eventId} surface="payout" />);
    expect(screen.getByText(/Redeemed ticket transfers: 6,000,000 VND/)).toBeTruthy();
    expect(screen.getByText(/Fees \(outside pool\): 600,000 VND/)).toBeTruthy();
    expect(screen.getByText(/Recorded overlay: 500,000 VND/)).toBeTruthy();
    expect(screen.getByText(/Required shortfall \(not funded\): 0 VND/)).toBeTruthy();
    expect(screen.getByText(/Funding revision: b+/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Finalize obligations" }).hasAttribute("disabled")).toBe(false);
  });

  it("holds Finalize for a required shortfall and exposes stale-source refresh", async () => {
    h.rpc.mockImplementation(async (name: string) => ({ data: name === "multi_day_floor_read_v1" ? read
      : name === "multi_day_qualification_preview_v1" ? qualification
        : name === "multi_day_payout_preview_v1" ? { ...payout, state: "REQUIRED_SHORTFALL", requiredShortfallVnd: 20_000 } : null, error: null }));
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout" />);
    await screen.findByText(/Required shortfall \(not funded\): 20,000 VND/);
    expect(screen.getByRole("button", { name: "Finalize obligations" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows TD/Floor owner-only labels without exposing payout mutations", async () => {
    const floorRead = { ...read, capabilities: {
      canFinalizePayout: false, canRequestAdjustment: false, canApproveAdjustment: false,
    } };
    h.rpc.mockImplementation(async (name: string) => ({ data: name === "multi_day_floor_read_v1" ? floorRead
      : name === "multi_day_qualification_preview_v1" ? qualification
        : name === "multi_day_payout_preview_v1" ? payout : null, error: null }));
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout" />);
    await screen.findByText(/Owner-only Finalize obligations/);
    expect(screen.queryByRole("button", { name: "Finalize obligations" })).toBeNull();
    expect(h.rpc).not.toHaveBeenCalledWith("multi_day_finalize_payout_v1", expect.anything());
    cleanup();
    h.rpc.mockImplementation(async (name: string) => ({ data: name === "multi_day_floor_read_v1"
      ? { ...floorRead, finalization: { ...payout, requestId: "original", finalizedAt: "now" },
        correctionRequests: [{ requestId: "pending", kind: "OBLIGATION_DELTA", deltaVnd: 1, reason: "Review", state: "PENDING_APPROVAL" }] }
      : name === "multi_day_qualification_preview_v1" ? qualification
        : { revision: "e".repeat(32), paidPlayerVnd: 0, unpaidObligationVnd: 1, unallocatedPoolVnd: 0 }, error: null }));
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout" />);
    await screen.findByText(/Owner-only Approve/);
    expect(screen.getByText(/Owner-only correction request/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Request correction" })).toBeNull();
  });

  it("retries Finalize with the same request id after an uncertain error", async () => {
    let attempts = 0;
    h.rpc.mockImplementation(async (name: string) => {
      if (name === "multi_day_floor_read_v1") return { data: read, error: null };
      if (name === "multi_day_qualification_preview_v1") return { data: qualification, error: null };
      if (name === "multi_day_payout_preview_v1") return { data: payout, error: null };
      if (name === "multi_day_finalize_payout_v1") {
        attempts += 1;
        return attempts === 1 ? { data: null, error: { message: "network unavailable" } }
          : { data: { ok: true }, error: null };
      }
      return { data: null, error: null };
    });
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout" />);
    fireEvent.click(await screen.findByRole("button", { name: "Finalize obligations" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Finalize obligations" }));
    await waitFor(() => expect(h.rpc.mock.calls.filter(([name]) => name === "multi_day_finalize_payout_v1")).toHaveLength(2));
    const calls = h.rpc.mock.calls.filter(([name]) => name === "multi_day_finalize_payout_v1");
    expect(calls[0][1].p_request_id).toBe(calls[1][1].p_request_id);
  });

  it("shows approved corrections as read-only and reports club denial", async () => {
    h.rpc.mockImplementation(async (name: string) => name === "multi_day_floor_read_v1"
      ? { data: { ...read, finalization: { ...payout, requestId: "original", finalizedAt: "now" },
        correctionRequests: [{ requestId: "correction", kind: "OBLIGATION_DELTA", deltaVnd: -1, reason: "Correct entitlement", state: "APPROVED" }] }, error: null }
      : name === "multi_day_qualification_preview_v1" ? { data: qualification, error: null }
        : name === "multi_day_payout_preview_v1" ? { data: payout, error: null }
          : { data: { revision: "e".repeat(32), paidPlayerVnd: 100_000, unpaidObligationVnd: 7_000_000, unallocatedPoolVnd: 399_600 }, error: null });
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout" />);
    await screen.findByText(/Correct entitlement/);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    cleanup();
    h.rpc.mockResolvedValue({ data: null, error: { message: "multi_day_floor_actor_denied", code: "42501" } });
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout" />);
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toMatch(/TD\/Floor or owner access denied/);
    cleanup();
    h.rpc.mockResolvedValue({ data: null, error: { message: "multi_day_package_release_off", code: "42501" } });
    render(<MultiDayFloorEventPanel eventId={eventId} surface="payout" />);
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toMatch(/package is off for this club/);
  });
});
