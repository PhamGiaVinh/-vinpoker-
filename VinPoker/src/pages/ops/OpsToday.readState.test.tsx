import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ loading: false, error: null as string | null }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock("@/hooks/useOperatorClubs", () => ({ useOperatorClubs: () => ({
  loading: false, user: { id: "actor" }, clubs: [{ id: "club", name: "TEST" }], operatorClubIds: ["club"], error: null,
}) }));
vi.mock("@/hooks/useTournaments", () => ({ useTournaments: () => ({ data: [] }) }));
vi.mock("@/hooks/useDealerSwing", () => ({
  useDealerOperationalTables: () => ({ data: [], ...state, refetch: vi.fn() }),
  useActiveAssignmentsWithTimeline: () => ({ data: [], loading: false, error: null, refetch: vi.fn() }),
  useCheckedInDealers: () => ({ data: [], loading: false, error: null, refetch: vi.fn() }),
}));
import OpsToday from "./OpsToday";

describe("OpsToday authoritative read state", () => {
  beforeEach(() => { state.loading = false; state.error = null; });
  it("does not report a healthy floor when inventory failed", () => {
    state.error = "503 TEST";
    render(<MemoryRouter><OpsToday /></MemoryRouter>);
    expect(screen.queryByText("Không có việc gấp — sàn đang ổn.")).not.toBeInTheDocument();
    expect(screen.getByText("Không xác minh được tình hình sàn")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
  });
  it("does not report empty counts while inventory is still loading", () => {
    state.loading = true;
    render(<MemoryRouter><OpsToday /></MemoryRouter>);
    expect(screen.queryByText("Không có việc gấp — sàn đang ổn.")).not.toBeInTheDocument();
    expect(screen.getByText("Đang xác minh tình hình sàn…")).toBeInTheDocument();
  });
});
