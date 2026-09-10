import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Dispatch, SetStateAction } from "react";
import type { QuantDraftQ1 } from "./opsQuantDashboardQ1";
import { OpsIntelligenceWorkspaceQ1 } from "./OpsIntelligenceWorkspaceQ1";

const state = vi.hoisted(() => ({ user: { id: "owner-a" } as { id: string } | null, observations: [] as unknown[] }));
vi.mock("@/ops/auth/OpsAuthProvider", () => ({ useOpsAuth: () => ({ user: state.user }) }));
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
  it("retains drafts across tabs but clears them and cached observations across actors", () => {
    const client = new QueryClient();
    const tree = () => <QueryClientProvider client={client}><OpsIntelligenceWorkspaceQ1 clubId="club-a" clubName="A" /></QueryClientProvider>;
    const view = render(tree());
    fireEvent.change(screen.getByLabelText("draft"), { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: "DATA HEALTH" }));
    expect(screen.queryByLabelText("draft")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "QUANT" }));
    expect(screen.getByLabelText("draft")).toHaveValue("200");
    client.setQueryData(["ops", "club-a", "intelligence", "pulse"], "old-private-observation");
    state.observations = [];
    state.user = { id: "owner-b" };
    view.rerender(tree());
    expect(screen.getByLabelText("draft")).toHaveValue("");
    expect(state.observations).not.toContain("old-private-observation");
    expect(client.getQueryData(["ops", "club-a", "intelligence", "pulse"])).toBeUndefined();
  });

  it("clears state on club change and unmounts on sign out", () => {
    const client = new QueryClient();
    const tree = (clubId: string) => <QueryClientProvider client={client}><OpsIntelligenceWorkspaceQ1 clubId={clubId} clubName={clubId} /></QueryClientProvider>;
    const view = render(tree("club-a"));
    fireEvent.change(screen.getByLabelText("draft"), { target: { value: "80" } });
    view.rerender(tree("club-b"));
    expect(screen.getByLabelText("draft")).toHaveValue("");
    client.setQueryData(["ops", "club-b", "intelligence", "pulse"], "private");
    state.user = null;
    view.rerender(tree("club-b"));
    expect(screen.queryByLabelText("draft")).toBeNull();
    expect(client.getQueryData(["ops", "club-b", "intelligence", "pulse"])).toBeUndefined();
  });
});
