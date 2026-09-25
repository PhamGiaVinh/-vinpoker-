import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

afterEach(cleanup);
const h = vi.hoisted(() => ({ rpc: vi.fn(), preview: null as unknown, get: null as unknown }));
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "is", "neq", "order"]) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: unknown) => unknown) => resolve({ data: [
    { id: "target-1c", name: "Main Event", start_time: "2026-10-01T12:00:00Z" }], error: null });
  return { supabase: { from: vi.fn(() => chain), rpc: h.rpc } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SatelliteAwardPlanPanel } from "../SatelliteAwardPlanPanel";
import { toast } from "sonner";
const awardPlan = { ok: true, locked: false, targetTournamentId: "target-1c",
  targetEntryPriceVnd: "6600000", ticketTotal: 1, cashTotalVnd: "0",
  totalLiabilityVnd: "6600000", awardLines: [{ position: 1, ticketCount: 1, cashVnd: "0" }] };
const funding = { state: "READY", sourcePoolVnd: "33000000", feeVnd: "6600000",
  targetEntryPriceVnd: "6600000", computedTicketCount: 5, cashRemainderVnd: "0",
  ticketShortfallVnd: "0", obligationShortfallVnd: "0", confirmedCount: 33,
  unpaidCount: 1, reversedCount: 1, previewRevision: "v2:12345678901234567890123456789012",
  awardPlan };
beforeAll(() => {
  globalThis.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  Element.prototype.scrollIntoView ||= () => {};
  Element.prototype.hasPointerCapture ||= () => false;
  Element.prototype.releasePointerCapture ||= () => {};
  Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true,
    value: () => "fa000000-0000-4000-8000-000000000001" });
});
beforeEach(() => {
  h.preview = { ...funding };
  h.get = { ok: true, locked: false };
  h.rpc.mockReset();
  h.rpc.mockImplementation(async (name: string) => {
    if (name === "satellite_get_award_plan_v1") return { data: h.get, error: null };
    if (name === "satellite_get_issuance_v1") return { data: { ok: true, issued: false }, error: null };
    if (name === "satellite_get_award_candidates_v1") return { data: { ok: true, players: [] }, error: null };
    if (name === "satellite_source_funding_preview_v2") return { data: h.preview, error: null };
    if (name === "satellite_lock_award_plan_v1") {
      h.get = { ...awardPlan, locked: true };
      return { data: { ok: true, locked: true, idempotent: false }, error: null };
    }
    throw new Error(`Unexpected RPC: ${name}`);
  });
  vi.mocked(toast.error).mockClear();
});
async function selectTarget() {
  fireEvent.keyDown(await screen.findByRole("combobox"), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: "Main Event" }));
}
describe("SatelliteAwardPlanPanel source preview", () => {
  it("shows server pool and fees separately and only offers Lock after a verified preview", async () => {
    render(<SatelliteAwardPlanPanel tournamentId="source" clubId="club" />);
    await selectTarget();
    fireEvent.click(screen.getByRole("button", { name: "Preview funding" }));
    expect(await screen.findByText(/Source pool: 33,000,000 VND/)).toBeTruthy();
    expect(screen.getByText(/Fees: 6,600,000 VND/)).toBeTruthy();
    expect(screen.getByText(/Confirmed: 33 · Unpaid: 1 · Reversed: 1/)).toBeTruthy();
    expect(h.rpc).toHaveBeenCalledWith("satellite_source_funding_preview_v2", {
      p_source_tournament_id: "source", p_target_tournament_id: "target-1c",
      p_awards: [{ position: 1, ticketCount: 1, cashVnd: "0" }],
    });
    expect(screen.getByRole("button", { name: "Lock award plan" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Issue tickets" })).toBeNull();
  });
  it("does not turn inconsistent source evidence into a zero pool", async () => {
    h.preview = { ...funding, state: "NOT_READY", sourcePoolVnd: null, feeVnd: null,
      issues: [{ registrationId: "row", reason: "legacy_price_snapshot_missing" }] };
    render(<SatelliteAwardPlanPanel tournamentId="source" clubId="club" />);
    await selectTarget();
    fireEvent.click(screen.getByRole("button", { name: "Preview funding" }));
    expect(await screen.findByText(/Pool and fees are unavailable/)).toBeTruthy();
    expect(screen.queryByText(/Source pool:/)).toBeNull();
  });
  it("labels a GTD shortfall as unfunded", async () => {
    h.preview = { ...funding, ticketShortfallVnd: "6600000", obligationShortfallVnd: "6600000" };
    render(<SatelliteAwardPlanPanel tournamentId="source" clubId="club" />);
    await selectTarget();
    fireEvent.click(screen.getByRole("button", { name: "Preview funding" }));
    expect(await screen.findByText(/Ticket guarantee shortfall: 6,600,000 VND — not funded/)).toBeTruthy();
  });
  it("reports invalid preview data in English and retains editable ranks", async () => {
    h.preview = null;
    render(<SatelliteAwardPlanPanel tournamentId="source" clubId="club" />);
    await selectTarget();
    fireEvent.click(screen.getByRole("button", { name: "Preview funding" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveProperty("textContent", "Invalid funding-preview response"));
    expect(screen.getByLabelText("Rank")).toBeTruthy();
  });
  it("rejects two tickets for one rank before calling the server", async () => {
    render(<SatelliteAwardPlanPanel tournamentId="source" clubId="club" />);
    await selectTarget();
    fireEvent.change(screen.getByLabelText("Tickets"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview funding" }));
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("at most one ticket per rank"));
    expect(h.rpc).not.toHaveBeenCalledWith("satellite_source_funding_preview_v2", expect.anything());
  });
  it("sends the exact preview revision and one request ID to server Lock", async () => {
    render(<SatelliteAwardPlanPanel tournamentId="source" clubId="club" />);
    await selectTarget();
    fireEvent.click(screen.getByRole("button", { name: "Preview funding" }));
    fireEvent.click(await screen.findByRole("button", { name: "Lock award plan" }));
    await waitFor(() => expect(screen.getByText(/Locked/)).toBeTruthy());
    expect(h.rpc).toHaveBeenCalledWith("satellite_lock_award_plan_v1", {
      p_source_tournament_id: "source", p_target_tournament_id: "target-1c",
      p_awards: [{ position: 1, ticketCount: 1, cashVnd: "0" }],
      p_expected_preview_revision: funding.previewRevision,
      p_request_id: "fa000000-0000-4000-8000-000000000001",
    });
    expect(screen.queryByRole("button", { name: "Issue tickets" })).toBeNull();
  });
  it("clears a stale preview and requires a fresh server read", async () => {
    h.rpc.mockImplementation(async (name: string) => {
      if (name === "satellite_get_award_plan_v1") return { data: h.get, error: null };
      if (name === "satellite_get_issuance_v1") return { data: { ok: true, issued: false }, error: null };
      if (name === "satellite_get_award_candidates_v1") return { data: { ok: true, players: [] }, error: null };
      if (name === "satellite_source_funding_preview_v2") return { data: h.preview, error: null };
      if (name === "satellite_lock_award_plan_v1") return { data: { ok: false, locked: false,
        error: "stale_preview" }, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    });
    render(<SatelliteAwardPlanPanel tournamentId="source" clubId="club" />);
    await selectTarget();
    fireEvent.click(screen.getByRole("button", { name: "Preview funding" }));
    fireEvent.click(await screen.findByRole("button", { name: "Lock award plan" }));
    expect(await screen.findByText(/Source funding changed/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Lock award plan" })).toBeNull();
  });
});
