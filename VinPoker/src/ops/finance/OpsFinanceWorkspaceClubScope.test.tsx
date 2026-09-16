import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  selectedClubId: "club-a",
  client: {},
  loadFinanceSummary: vi.fn(),
}));

vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({
  useSupabaseClient: () => mock.client,
}));
vi.mock("@/ops/auth/OpsCapabilityProvider", () => ({
  useOpsCapabilities: () => ({
    loading: false, scopeError: null, isSuperAdmin: false,
    moduleClubIds: () => ["club-a", "club-b"],
    clubs: [{ id: "club-a", name: "Club A" }, { id: "club-b", name: "Club B" }],
  }),
}));
vi.mock("@/ops/workspace/OpsWorkspaceProvider", () => ({
  useOpsWorkspace: () => ({ selectedClubId: mock.selectedClubId }),
}));
vi.mock("@/ops/opsMutations", () => ({ OPS_CASHIER_MUTATIONS_ENABLED: false }));
vi.mock("./CashierCashflowPanel", () => ({ default: () => null }));
vi.mock("./financeReadAdapter", () => ({
  currentMonthFinanceRange: () => ({ from: "2026-09-01", to: "2026-10-01" }),
  loadFinanceSummary: mock.loadFinanceSummary,
}));
vi.mock("./FinanceWorkspaceView", () => ({
  FinanceWorkspaceView: ({ clubName, summary, loading }: {
    clubName: string; summary: { revenue: { total: number } } | null; loading: boolean;
  }) => <div>{clubName}: {loading ? "loading" : summary?.revenue.total ?? "empty"}</div>,
}));

import OpsFinanceWorkspace from "./OpsFinanceWorkspace";

describe("Finance club scope", () => {
  beforeEach(() => {
    mock.selectedClubId = "club-a";
    mock.loadFinanceSummary.mockReset();
  });

  it("hides the previous club immediately and ignores its late response", async () => {
    const pending = new Map<string, (value: unknown) => void>();
    mock.loadFinanceSummary.mockImplementation((_client: unknown, clubId: string) =>
      new Promise((resolve) => { pending.set(clubId, resolve); }));

    const view = render(<OpsFinanceWorkspace />);
    await waitFor(() => expect(pending.has("club-a")).toBe(true));
    mock.selectedClubId = "club-b";
    view.rerender(<OpsFinanceWorkspace />);
    expect(screen.getByText("Club B: loading")).toBeTruthy();
    await waitFor(() => expect(pending.has("club-b")).toBe(true));

    await act(async () => { pending.get("club-b")?.({ revenue: { total: 200 } }); });
    expect(screen.getByText("Club B: 200")).toBeTruthy();
    await act(async () => { pending.get("club-a")?.({ revenue: { total: 100 } }); });
    expect(screen.getByText("Club B: 200")).toBeTruthy();
    expect(screen.queryByText("Club B: 100")).toBeNull();
  });

  it("does not show already-loaded Club A totals under Club B while B loads", async () => {
    const pending = new Map<string, (value: unknown) => void>();
    mock.loadFinanceSummary.mockImplementation((_client: unknown, clubId: string) =>
      new Promise((resolve) => { pending.set(clubId, resolve); }));

    const view = render(<OpsFinanceWorkspace />);
    await waitFor(() => expect(pending.has("club-a")).toBe(true));
    await act(async () => { pending.get("club-a")?.({ revenue: { total: 100 } }); });
    expect(screen.getByText("Club A: 100")).toBeTruthy();

    mock.selectedClubId = "club-b";
    view.rerender(<OpsFinanceWorkspace />);
    expect(screen.getByText("Club B: loading")).toBeTruthy();
    expect(screen.queryByText("Club B: 100")).toBeNull();
  });
});
