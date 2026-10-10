import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ actorId: "actor", inventoryError: "503 TEST" as string | null }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: state.actorId } }) }));
vi.mock("@/hooks/useOperatorClubs", () => ({ useOperatorClubs: () => ({
  loading: false, user: { id: state.actorId }, clubs: [{ id: "club", name: "TEST" }], clubIds: ["club"], dealerClubIds: ["club"], error: null,
}) }));
vi.mock("@/hooks/usePublishedDealerSchedule", () => ({ usePublishedDealerSchedule: () => ({ daysByDate: {}, loading: false, error: null }) }));
vi.mock("@/hooks/useDealerSwingPhoneRollout", () => ({ useDealerSwingPhoneRollout: () => ({ enabled: false, loading: false, error: null }) }));
vi.mock("@/hooks/useShiftPlanner", () => ({ useShiftPlanner: () => ({ data: null, loading: false, error: null, refetch: vi.fn() }) }));
vi.mock("@/hooks/useDealerSwing", () => ({
  useDealerOperationalTables: () => ({ data: [], loading: false, error: state.inventoryError, refetch: vi.fn() }),
  useActiveAssignmentsWithTimeline: () => ({ data: [], loading: false, error: null, refetch: vi.fn() }),
  useCheckedInDealers: () => ({ data: [], loading: false, error: null, refetch: vi.fn() }),
  useTodayCheckedOutDealers: () => ({ data: [], loading: false, error: null, refetch: vi.fn() }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } } }));
import OpsDealerSwing from "./OpsDealerSwing";

describe("Swing mobile read verification", () => {
  beforeEach(() => { state.actorId = "actor"; state.inventoryError = "503 TEST"; });
  it("does not expose operational actions when table inventory failed", async () => {
    render(<MemoryRouter><OpsDealerSwing /></MemoryRouter>);
    expect(await screen.findByText("Không xác minh được dữ liệu Dealer Swing")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Check-in/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
  });
  it("does not carry the previous actor's selected screen into the same club", async () => {
    state.inventoryError = null;
    const view = render(<MemoryRouter><OpsDealerSwing /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Dealer" }));
    expect(screen.getByText("Chưa có dealer nào trong ca.")).toBeInTheDocument();
    state.actorId = "actor-b";
    view.rerender(<MemoryRouter><OpsDealerSwing /></MemoryRouter>);
    expect(screen.queryByText("Chưa có dealer nào trong ca.")).not.toBeInTheDocument();
    expect(screen.getByText("Chưa có bàn nào đang mở.")).toBeInTheDocument();
  });
});
