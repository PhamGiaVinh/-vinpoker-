import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ actor: "actor", club: "A", allowed: true, scopeLoading: false,
  scopeError: null as string | null, tournament: "flight", load: vi.fn(), inventory: vi.fn(), client: {} }));
vi.mock("@/ops/auth/OpsAuthProvider", () => ({ useOpsAuth: () => ({ user: h.actor ? { id: h.actor } : null, loading: false }) }));
vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({ useSupabaseClient: () => h.client }));
vi.mock("@/ops/workspace/OpsWorkspaceProvider", () => ({ useOpsWorkspace: () => ({ selectedClubId: h.club }) }));
vi.mock("@/ops/auth/OpsCapabilityProvider", () => ({ useOpsCapabilities: () => ({
  loading: h.scopeLoading, scopeError: h.scopeError, isSuperAdmin: false,
  moduleClubIds: () => h.allowed ? ["A", "B"] : [], clubs: [],
}) }));
vi.mock("react-router-dom", () => ({ useSearchParams: () => [new URLSearchParams({ t: h.tournament }), vi.fn()] }));
vi.mock("./chipOpsReadAdapter", () => ({
  loadChipOpsTournamentOptions: (...args: unknown[]) => h.load(...args),
  loadIssuedChipInventory: (...args: unknown[]) => h.inventory(...args), loadIssuedStackSummary: async () => null,
}));
vi.mock("./ChipOpsWorkspaceView", () => ({ ChipOpsWorkspaceView: (p: { tournaments: { name: string }[]; inventory: unknown }) =>
  <div><div>{p.tournaments.map((t) => t.name).join(",")}</div><div>{JSON.stringify(p.inventory)}</div></div> }));
vi.mock("./MultiDayBaggingPanel", () => ({ MultiDayBaggingPanel: () => <div>bagging-actions</div> }));
import OpsChipOpsWorkspace from "./OpsChipOpsWorkspace";

beforeEach(() => {
  h.actor = "actor"; h.club = "A"; h.allowed = true; h.scopeLoading = false; h.scopeError = null;
  h.tournament = "flight"; h.load.mockReset(); h.inventory.mockReset(); h.inventory.mockResolvedValue(null);
});

it("does not replace club B results with a late club A response", async () => {
  let resolveA!: (value: unknown) => void;
  h.load.mockImplementation((_client, club) => club === "A"
    ? new Promise((resolve) => { resolveA = resolve; })
    : Promise.resolve([{ id: "flight", name: "B tour", phase: "flight" }]));
  const view = render(<OpsChipOpsWorkspace />);
  await waitFor(() => expect(h.load).toHaveBeenCalledTimes(1));
  h.club = "B";
  view.rerender(<OpsChipOpsWorkspace />);
  await screen.findByText("B tour");
  await act(async () => resolveA([{ id: "flight", name: "A tour", phase: "flight" }]));
  expect(screen.queryByText("A tour")).toBeNull();
  expect(screen.getByText("B tour")).toBeTruthy();
});

it("removes bagging actions immediately when chip scope is lost", async () => {
  h.load.mockResolvedValue([{ id: "flight", name: "A tour", phase: "flight" }]);
  const view = render(<OpsChipOpsWorkspace />);
  await screen.findByText("bagging-actions");
  h.allowed = false;
  view.rerender(<OpsChipOpsWorkspace />);
  expect(screen.queryByText("bagging-actions")).toBeNull();
  expect(screen.queryByText("A tour")).toBeNull();
});

it("does not revive an old A lifetime after A -> B -> A", async () => {
  const resolvers: ((value: unknown) => void)[] = [];
  h.load.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
  const view = render(<OpsChipOpsWorkspace />);
  h.club = "B";
  view.rerender(<OpsChipOpsWorkspace />);
  h.club = "A";
  view.rerender(<OpsChipOpsWorkspace />);
  await act(async () => resolvers[2]([{ id: "flight", name: "fresh A", phase: "flight" }]));
  await act(async () => {
    resolvers[0]([{ id: "flight", name: "old A", phase: "flight" }]);
    resolvers[1]([{ id: "flight", name: "old B", phase: "flight" }]);
  });
  expect(screen.getByText("fresh A")).toBeTruthy();
  expect(screen.queryByText("old A")).toBeNull();
  expect(screen.queryByText("old B")).toBeNull();
});

it("clears the old actor's loaded actions and options at logout", async () => {
  h.load.mockResolvedValue([{ id: "flight", name: "private tour", phase: "flight" }]);
  const view = render(<OpsChipOpsWorkspace />);
  await screen.findByText("bagging-actions");
  h.actor = "";
  view.rerender(<OpsChipOpsWorkspace />);
  expect(screen.queryByText("private tour")).toBeNull();
  expect(screen.queryByText("bagging-actions")).toBeNull();
  expect(h.load).toHaveBeenCalledTimes(1);
});

it("ignores delayed inventory from the previous tournament", async () => {
  let resolveOld!: (value: unknown) => void;
  h.load.mockResolvedValue([
    { id: "flight", name: "first", phase: "flight" },
    { id: "next", name: "second", phase: "flight" },
  ]);
  h.inventory.mockImplementation((_client, tournament) => tournament === "flight"
    ? new Promise((resolve) => { resolveOld = resolve; }) : Promise.resolve("new inventory"));
  const view = render(<OpsChipOpsWorkspace />);
  await waitFor(() => expect(h.inventory).toHaveBeenCalledTimes(1));
  h.tournament = "next";
  view.rerender(<OpsChipOpsWorkspace />);
  await screen.findByText('"new inventory"');
  await act(async () => resolveOld("old inventory"));
  expect(screen.queryByText('"old inventory"')).toBeNull();
  expect(screen.getByText('"new inventory"')).toBeTruthy();
});

it.each(["loading", "error"])("removes actions on scope %s and reloads on recovery", async (reason) => {
  h.load.mockResolvedValue([{ id: "flight", name: "private tour", phase: "flight" }]);
  const view = render(<OpsChipOpsWorkspace />);
  await screen.findByText("bagging-actions");
  h.scopeLoading = reason === "loading";
  h.scopeError = reason === "error" ? "READ_FAILED" : null;
  view.rerender(<OpsChipOpsWorkspace />);
  expect(screen.queryByText("bagging-actions")).toBeNull();
  expect(screen.queryByText("private tour")).toBeNull();
  h.scopeLoading = false;
  h.scopeError = null;
  view.rerender(<OpsChipOpsWorkspace />);
  await screen.findByText("bagging-actions");
  expect(h.load).toHaveBeenCalledTimes(2);
});
