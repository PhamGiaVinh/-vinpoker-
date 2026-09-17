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
  h.rpc.mockReset();
  h.rpc.mockImplementation(async (name: string) => name === "satellite_get_award_plan_v1" ? h.getResult : h.planResult);
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
    expect(h.rpc).toHaveBeenCalledWith("satellite_award_plan_v1", expect.objectContaining({
      p_source_tournament_id: "source", p_target_tournament_id: "target-1c",
      p_awards: [{ position: 1, ticketCount: 1, cashVnd: "0" }], p_lock: false,
    }));
    fireEvent.click(screen.getByRole("checkbox"));
    h.planResult = { data: { ...h.planResult.data, locked: true }, error: null };
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
});
