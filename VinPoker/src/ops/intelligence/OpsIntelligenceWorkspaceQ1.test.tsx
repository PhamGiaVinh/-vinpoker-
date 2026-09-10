import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Dispatch, SetStateAction } from "react";
import type { QuantDraftQ1 } from "./opsQuantDashboardQ1";
import { OpsIntelligenceWorkspaceQ1 } from "./OpsIntelligenceWorkspaceQ1";

const state = vi.hoisted(() => ({ user: { id: "owner-a" } as { id: string } | null, observations: [] as unknown[] }));
vi.mock("@/ops/auth/OpsAuthProvider", () => ({ useOpsAuth: () => ({ user: state.user }) }));
vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({ useSupabaseClient: () => ({}) }));
vi.mock("./opsIntelligenceContextQuery", () => ({ contextQueryOptions: (_client: unknown, clubId: string) => ({ queryKey: ["ops", clubId, "intelligence", "context-v1"], queryFn: async () => ({ value: { version: "ops-intelligence-context-v1", clubId, asOf: "2026-09-10T00:00:00.000Z", dailyTournaments: [], festivals: [] }, observedAt: "2026-09-10T00:00:01.000Z" }) }) }));
vi.mock("./OpsIntelligenceOverviewView", () => ({ OpsIntelligenceOverviewV1: () => <p>Overview only</p> }));
vi.mock("./OpsIntelligenceCommandCenterV1", () => ({ OpsIntelligenceCommandCenterV1: () => <p>Live only</p> }));
vi.mock("./OpsQuantDataHealthQ0Panel", () => ({ OpsQuantDataHealthQ0Panel: () => <p>Health only</p> }));
vi.mock("./OpsQuantDashboardQ1View", () => ({
  OpsQuantDashboardQ1View: ({ clubId, draft, onDraftChange }: { clubId: string; draft: QuantDraftQ1; onDraftChange: Dispatch<SetStateAction<QuantDraftQ1>> }) => {
    const client = useQueryClient();
    state.observations.push(client.getQueryData(["ops", clubId, "intelligence", "pulse"]));
    return <input aria-label="draft" value={draft.customEntries} onChange={(event) => onDraftChange((previous) => ({ ...previous, customEntries: event.target.value }))} />;
  },
}));

afterEach(() => { cleanup(); state.user = { id: "owner-a" }; state.observations = []; });

describe("Q1 workspace lifetime", () => {
  it("purges a prefilled destination before initial mount or simultaneous actor/club change", () => {
    const client = new QueryClient();
    const key = (clubId: string) => ["ops", clubId, "intelligence", "pulse"];
    client.setQueryData(key("club-a"), "prior-actor-initial");
    const tree = (clubId: string) => <QueryClientProvider client={client}><OpsIntelligenceWorkspaceQ1 clubId={clubId} clubName={clubId} /></QueryClientProvider>;
    const view = render(tree("club-a"));
    fireEvent.click(screen.getByRole("button", { name: "QUANT", exact: true }));
    expect(state.observations).not.toContain("prior-actor-initial");
    client.setQueryData(key("club-b"), "prior-actor-destination");
    state.user = { id: "owner-b" };
    state.observations = [];
    view.rerender(tree("club-b"));
    fireEvent.click(screen.getByRole("button", { name: "QUANT", exact: true }));
    expect(state.observations).not.toContain("prior-actor-destination");
    expect(client.getQueryData(key("club-b"))).toBeUndefined();
  });
  it("retains drafts across tabs but clears them and cached observations across actors", () => {
    const client = new QueryClient();
    const tree = () => <QueryClientProvider client={client}><OpsIntelligenceWorkspaceQ1 clubId="club-a" clubName="A" /></QueryClientProvider>;
    const view = render(tree());
    expect(screen.getByText("Overview only")).toBeVisible();
    expect(screen.queryByLabelText("draft")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "QUANT", exact: true }));
    fireEvent.change(screen.getByLabelText("draft"), { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: "DATA HEALTH" }));
    expect(screen.queryByLabelText("draft")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "QUANT" }));
    expect(screen.getByLabelText("draft")).toHaveValue("200");
    client.setQueryData(["ops", "club-a", "intelligence", "pulse"], "old-private-observation");
    state.observations = [];
    state.user = { id: "owner-b" };
    view.rerender(tree());
    expect(screen.getByText("Overview only")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "QUANT", exact: true }));
    expect(screen.getByLabelText("draft")).toHaveValue("");
    expect(state.observations).not.toContain("old-private-observation");
    expect(client.getQueryData(["ops", "club-a", "intelligence", "pulse"])).toBeUndefined();
  });

  it("clears state on club change and unmounts on sign out", () => {
    const client = new QueryClient();
    const tree = (clubId: string) => <QueryClientProvider client={client}><OpsIntelligenceWorkspaceQ1 clubId={clubId} clubName={clubId} /></QueryClientProvider>;
    const view = render(tree("club-a"));
    fireEvent.click(screen.getByRole("button", { name: "QUANT", exact: true }));
    fireEvent.change(screen.getByLabelText("draft"), { target: { value: "80" } });
    view.rerender(tree("club-b"));
    fireEvent.click(screen.getByRole("button", { name: "QUANT", exact: true }));
    expect(screen.getByLabelText("draft")).toHaveValue("");
    client.setQueryData(["ops", "club-b", "intelligence", "pulse"], "private");
    state.user = null;
    view.rerender(tree("club-b"));
    expect(screen.queryByLabelText("draft")).toBeNull();
    expect(client.getQueryData(["ops", "club-b", "intelligence", "pulse"])).toBeUndefined();
  });
});
