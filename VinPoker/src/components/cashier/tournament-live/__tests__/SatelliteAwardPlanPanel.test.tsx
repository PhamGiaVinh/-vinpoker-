import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

afterEach(cleanup);
type RpcResult = { data: unknown; error: { message: string } | null };

const h = vi.hoisted(() => ({
  targets: [{ id: "target-1c", name: "Main Event · Flight 1C", start_time: "2026-10-01T12:00:00Z" }],
  targetError: null as null | { message: string },
  getResult: { data: { ok: true, locked: false }, error: null } as RpcResult,
  planResult: { data: {
    ok: true, locked: false, targetTournamentId: "target-1c",
    targetEntryPriceVnd: "6600000", ticketTotal: 1,
    cashTotalVnd: "0", totalLiabilityVnd: "6600000",
    awardLines: [{ position: 1, ticketCount: 1, cashVnd: "0" }],
  }, error: null } as RpcResult,
  issuanceResult: { data: { ok: true, issued: false }, error: null } as RpcResult,
  candidatesResult: { data: { ok: true, players: [{ playerId: "player-1", displayName: "Player One" }] }, error: null } as RpcResult,
  issueResult: { data: { ok: true, issued: true, ticketTotal: 1, tickets: [{ serial: 1, code: "private-code", position: 1, winnerPlayerId: "player-1", status: "issued" }] }, error: null } as RpcResult,
  fundingResult: { data: { ok: true, locked: true, canApprove: true, sourceConfirmedGrossVnd: "7920000", sourceEntryFeesVnd: "1320000", sourcePoolVnd: "6600000", ticketLiabilityVnd: "6600000", cashLiabilityVnd: "0", overlayVnd: "0", remainingVnd: "0" }, error: null } as RpcResult,
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => {
  const makeChain = () => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "filter", "in", "is", "neq", "order"]) chain[method] = vi.fn(() => chain);
    chain.then = (resolve: (value: unknown) => unknown) => resolve({ data: h.targets, error: h.targetError });
    return chain;
  };
  return { supabase: { from: vi.fn(() => makeChain()), rpc: h.rpc } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SatelliteAwardPlanPanel } from "../SatelliteAwardPlanPanel";
import { toast } from "sonner";

beforeAll(() => {
  globalThis.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  Element.prototype.scrollIntoView ||= () => {};
  Element.prototype.hasPointerCapture ||= () => false;
  Element.prototype.releasePointerCapture ||= () => {};
});

beforeEach(() => {
  h.targets = [{ id: "target-1c", name: "Main Event · Flight 1C", start_time: "2026-10-01T12:00:00Z" }];
  h.targetError = null;
  h.getResult = { data: { ok: true, locked: false }, error: null };
  h.planResult = { data: {
    ok: true, locked: false, targetTournamentId: "target-1c",
    targetEntryPriceVnd: "6600000", ticketTotal: 1,
    cashTotalVnd: "0", totalLiabilityVnd: "6600000",
    awardLines: [{ position: 1, ticketCount: 1, cashVnd: "0" }],
  }, error: null };
  h.issuanceResult = { data: { ok: true, issued: false }, error: null };
  h.candidatesResult = { data: { ok: true, players: [{ playerId: "player-1", displayName: "Player One" }] }, error: null };
  h.issueResult = { data: { ok: true, issued: true, ticketTotal: 1, tickets: [{ serial: 1, code: "private-code", position: 1, winnerPlayerId: "player-1", status: "issued" }] }, error: null };
  h.fundingResult = { data: { ok: true, locked: true, canApprove: true, sourceConfirmedGrossVnd: "7920000", sourceEntryFeesVnd: "1320000", sourcePoolVnd: "6600000", ticketLiabilityVnd: "6600000", cashLiabilityVnd: "0", overlayVnd: "0", remainingVnd: "0" }, error: null };
  h.rpc.mockReset();
  h.rpc.mockImplementation(async (name: string, args: { p_lock?: boolean }) => {
    if (name === "satellite_get_award_plan_v1") return h.getResult;
    if (name === "satellite_get_issuance_v1") return h.issuanceResult;
    if (name === "satellite_get_award_candidates_v1") return h.candidatesResult;
    if (name === "satellite_issue_tickets_v1") return h.issueResult;
    if (name === "satellite_get_funding_v1") return h.fundingResult;
    if (name === "satellite_approve_funding_v1") return { data: {
      ok: true, locked: args.p_lock === true,
      sourceConfirmedGrossVnd: "2400000", sourceEntryFeesVnd: "400000",
      sourcePoolVnd: "2000000", ticketLiabilityVnd: "6600000",
      cashLiabilityVnd: "0", overlayVnd: "4600000", remainingVnd: "0",
    }, error: null };
    if (name === "satellite_get_transfer_summary_v1") return { data: {
      ok: true, issuedCount: 1, redeemedCount: 0, issuedValueVnd: "6600000",
      transferredValueVnd: "0", outstandingValueVnd: "6600000", unissuedValueVnd: "0",
    }, error: null };
    return h.planResult;
  });
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
});

describe("SatelliteAwardPlanPanel", () => {
  it("rejects two tickets for one finishing place before calling the server", async () => {
    render(<SatelliteAwardPlanPanel tournamentId="source" clubId="club" />);
    fireEvent.keyDown(await screen.findByRole("combobox"), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "Main Event · Flight 1C" }));
    fireEvent.change(await screen.findByLabelText("Tickets"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview obligations" }));
    expect(toast.error).toHaveBeenCalledWith("Use unique ranks, at most one ticket per rank, and a non-negative cash amount.");
    expect(h.rpc).not.toHaveBeenCalledWith("satellite_award_plan_v1", expect.anything());
  });

  it("fails closed on a plan read error and offers Retry, not an empty editable plan", async () => {
    h.getResult = { data: null, error: { message: "plan read failed" } };
    render(<SatelliteAwardPlanPanel tournamentId="source" clubId="club" />);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "plan read failed");
    expect(screen.queryByRole("button", { name: "Lock award plan" })).toBeNull();
    h.getResult = { data: { ok: true, locked: false }, error: null };
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: "Preview obligations" })).toBeTruthy();
  });

  it("shows an immutable server-locked plan and no lock control", async () => {
    h.getResult = { data: { ...(h.planResult.data as Record<string, unknown>), locked: true }, error: null };
    render(<SatelliteAwardPlanPanel tournamentId="source" clubId="club" />);
    expect(await screen.findByText("6,600,000 VND")).toBeTruthy();
    expect(screen.getByText("Main Event · Flight 1C")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Lock award plan" })).toBeNull();
  });

  it("requires preview and explicit confirmation before asking the server to lock", async () => {
    render(<SatelliteAwardPlanPanel tournamentId="source" clubId="club" />);
    fireEvent.keyDown(await screen.findByRole("combobox"), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "Main Event · Flight 1C" }));
    expect(screen.getByRole("button", { name: "Lock award plan" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Preview obligations" }));
    await screen.findByText("Total obligation: 6,600,000 VND");
    expect(h.rpc).toHaveBeenCalledWith("satellite_award_plan_v1", expect.objectContaining({
      p_source_tournament_id: "source", p_target_tournament_id: "target-1c",
      p_awards: [{ position: 1, ticketCount: 1, cashVnd: "0" }], p_lock: false,
    }));
    fireEvent.click(screen.getByRole("checkbox"));
    h.planResult = { data: { ...(h.planResult.data as Record<string, unknown>), locked: true }, error: null };
    fireEvent.click(screen.getByRole("button", { name: "Lock award plan" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Satellite award plan locked"));
    expect(h.rpc).toHaveBeenCalledWith("satellite_award_plan_v1", expect.objectContaining({ p_lock: true }));
  });

  it("rejects malformed server totals without offering the lock action", async () => {
    h.planResult = { data: { ok: true, locked: false, targetTournamentId: "target-1c" }, error: null };
    render(<SatelliteAwardPlanPanel tournamentId="source" clubId="club" />);
    fireEvent.keyDown(await screen.findByRole("combobox"), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "Main Event · Flight 1C" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview obligations" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Lock award plan" })).toHaveProperty("disabled", true);
  });

  it("fails closed when the private ticket ledger cannot load", async () => {
    h.issuanceResult = { data: null, error: { message: "ledger unavailable" } };
    render(<SatelliteAwardPlanPanel tournamentId="source" clubId="club" />);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "ledger unavailable");
    expect(screen.queryByRole("button", { name: "Issue tickets" })).toBeNull();
  });

  it("does not allow issuance when source funding is not locked", async () => {
    h.getResult = { data: { ...(h.planResult.data as Record<string, unknown>), locked: true }, error: null };
    h.fundingResult = { data: { ok: true, locked: false, canApprove: false }, error: null };
    render(<SatelliteAwardPlanPanel tournamentId="source" clubId="club" />);
    const issueButton = await screen.findByRole("button", { name: "Issue tickets" });
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: "Player One" }));
    fireEvent.click(screen.getByRole("checkbox"));
    expect(issueButton).toHaveProperty("disabled", true);
    expect(h.rpc).not.toHaveBeenCalledWith("satellite_issue_tickets_v1", expect.anything());
  });

  it("requires owner review of the exact pool and overlay before locking funding", async () => {
    h.getResult = { data: { ...(h.planResult.data as Record<string, unknown>), locked: true }, error: null };
    h.fundingResult = { data: { ok: true, locked: false, canApprove: true }, error: null };
    render(<SatelliteAwardPlanPanel tournamentId="source" clubId="club" />);
    fireEvent.click(await screen.findByRole("button", { name: "Preview source funding" }));
    await screen.findByText("Club overlay required: 4,600,000 VND");
    const lockFunding = screen.getByRole("button", { name: "Lock funding" });
    expect(lockFunding).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("checkbox", { name: /approve this exact source funding/ }));
    fireEvent.click(lockFunding);
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("satellite_approve_funding_v1", {
      p_source_tournament_id: "source", p_overlay_vnd: "4600000", p_lock: true,
    }));
    expect(await screen.findByText("Club overlay approved")).toBeTruthy();
  });

  it("requires an assigned winner and confirmation before issuing once", async () => {
    h.getResult = { data: { ...(h.planResult.data as Record<string, unknown>), locked: true }, error: null };
    render(<SatelliteAwardPlanPanel tournamentId="source" clubId="club" />);
    const issueButton = await screen.findByRole("button", { name: "Issue tickets" });
    expect(issueButton).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: "Player One" }));
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(issueButton).toHaveProperty("disabled", false));
    fireEvent.click(issueButton);
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("satellite_issue_tickets_v1", {
      p_source_tournament_id: "source", p_results: [{ position: 1, playerId: "player-1" }],
    }));
    expect(await screen.findByText("Issued 1 / 1 tickets")).toBeTruthy();
    expect(screen.getByText("Show private ticket QR")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Issue tickets" })).toBeNull();
  });
});
