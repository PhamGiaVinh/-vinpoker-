import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const backend = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));
const auth = vi.hoisted(() => ({
  user: { id: "tracker-user" },
  loading: false,
  isTracker: true,
  isAdmin: false,
  isClubOwner: false,
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: backend }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => auth,
}));
vi.mock("@/components/cashier/tournament-live/HandHistoryPanel", () => ({
  HandHistoryPanel: ({ tournamentId, workspaceMode, enableHistoricalBatchControls }: {
    tournamentId: string;
    workspaceMode: boolean;
    enableHistoricalBatchControls: boolean;
  }) => (
    <div data-testid="hand-history-panel" data-tournament={tournamentId} data-workspace={workspaceMode} data-batch={enableHistoricalBatchControls}>
      Danh sách bàn và hand
    </div>
  ),
}));

import TrackerHandHistory from "@/pages/TrackerHandHistory";

function tournamentQuery() {
  const response = {
    data: [
      { id: "tour-live", club_id: "club-1", name: "TEST — Felt UAT", status: "live", created_at: "2026-08-11T00:00:00Z" },
      { id: "tour-old", club_id: "club-1", name: "Summer Classic", status: "completed", created_at: "2026-07-01T00:00:00Z" },
    ],
    error: null,
  };
  const query = {
    select: vi.fn(),
    order: vi.fn(),
    in: vi.fn(),
    then: (resolve: (value: typeof response) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(response).then(resolve, reject),
  };
  query.select.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.in.mockReturnValue(query);
  return query;
}

beforeEach(() => {
  backend.rpc.mockResolvedValue({ data: ["club-1"], error: null });
  backend.from.mockImplementation(() => tournamentQuery());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Tracker hand history workspace", () => {
  it("renders the tournament-first workflow and opens the server-backed hand archive", async () => {
    render(<MemoryRouter initialEntries={["/tracker/history?t=tour-live"]}><TrackerHandHistory /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "Lịch sử & sửa hand" })).toBeInTheDocument();
    expect(screen.getByText("TEST — Felt UAT", { selector: "h2" })).toBeInTheDocument();
    expect(screen.getByTestId("hand-history-panel")).toHaveAttribute("data-tournament", "tour-live");
    expect(screen.getByTestId("hand-history-panel")).toHaveAttribute("data-workspace", "true");
    expect(screen.getByTestId("hand-history-panel")).toHaveAttribute("data-batch", "true");
  });

  it("filters the tournament archive without hiding completed events by default", async () => {
    render(<MemoryRouter initialEntries={["/tracker/history?t=tour-live"]}><TrackerHandHistory /></MemoryRouter>);
    await screen.findByText("Summer Classic");

    fireEvent.change(screen.getByRole("textbox", { name: "Tìm giải đấu" }), { target: { value: "summer" } });

    await waitFor(() => expect(screen.queryByText("TEST — Felt UAT", { selector: "button span" })).not.toBeInTheDocument());
    expect(screen.getByText("Summer Classic")).toBeInTheDocument();
  });
});
