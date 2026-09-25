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
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => {
  const makeChain = () => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "is", "neq", "order"]) chain[method] = vi.fn(() => chain);
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
  h.rpc.mockReset();
  h.rpc.mockImplementation(async (name: string) => {
    if (name === "satellite_get_award_plan_v1") return h.getResult;
    if (name === "satellite_get_issuance_v1") return h.issuanceResult;
    if (name === "satellite_get_award_candidates_v1") return h.candidatesResult;
    if (name === "satellite_issue_tickets_v1") return h.issueResult;
    return h.planResult;
  });
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
});

describe("SatelliteAwardPlanPanel", () => {
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
    h.getResult = { data: { ...h.planResult.data, locked: true }, error: null };
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
    expect(h.rpc).toHaveBeenCalledWith("satellite_award_plan_v2", expect.objectContaining({
      p_source_tournament_id: "source", p_target_tournament_id: "target-1c",
      p_awards: [{ position: 1, ticketCount: 1, cashVnd: "0" }], p_lock: false,
    }));
    fireEvent.click(screen.getByRole("checkbox"));
    h.planResult = { data: { ...h.planResult.data, locked: true }, error: null };
    fireEvent.click(screen.getByRole("button", { name: "Lock award plan" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Satellite award plan locked"));
    expect(h.rpc).toHaveBeenCalledWith("satellite_award_plan_v2", expect.objectContaining({ p_lock: true }));
  });

  it("never previews two tickets for one finishing place", async () => {
    render(<SatelliteAwardPlanPanel tournamentId="source" clubId="club" />);
    fireEvent.keyDown(await screen.findByRole("combobox"), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "Main Event · Flight 1C" }));
    fireEvent.change(screen.getByLabelText("Tickets"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview obligations" }));
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("at most one ticket per rank"));
    expect(h.rpc).not.toHaveBeenCalledWith("satellite_award_plan_v2", expect.anything());
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

  it("fails closed if the server returns more than one ticket for a rank", async () => {
    h.getResult = { data: {
      ...h.planResult.data, locked: true, ticketTotal: 2,
      totalLiabilityVnd: "13200000",
      awardLines: [{ position: 1, ticketCount: 2, cashVnd: "0" }],
    }, error: null };
    render(<SatelliteAwardPlanPanel tournamentId="source" clubId="club" />);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Invalid award-plan obligations");
    expect(screen.queryByRole("button", { name: "Issue tickets" })).toBeNull();
  });

  it("fails closed when the private ticket ledger cannot load", async () => {
    h.issuanceResult = { data: null, error: { message: "ledger unavailable" } };
    render(<SatelliteAwardPlanPanel tournamentId="source" clubId="club" />);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "ledger unavailable");
    expect(screen.queryByRole("button", { name: "Issue tickets" })).toBeNull();
  });

  it("requires an assigned winner and confirmation before issuing once", async () => {
    h.getResult = { data: { ...h.planResult.data, locked: true }, error: null };
    render(<SatelliteAwardPlanPanel tournamentId="source" clubId="club" />);
    const issueButton = await screen.findByRole("button", { name: "Issue tickets" });
    expect(issueButton).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: "Player One" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(issueButton);
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("satellite_issue_tickets_v1", {
      p_source_tournament_id: "source", p_results: [{ position: 1, playerId: "player-1" }],
    }));
    expect(await screen.findByText("Issued 1 / 1 tickets")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Issue tickets" })).toBeNull();
  });
});
