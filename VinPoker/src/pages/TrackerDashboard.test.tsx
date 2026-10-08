import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryResponse = { data: Array<{ id: string; name: string }>; error: unknown | null };
type QueryBuilder = {
  select: () => QueryBuilder;
  in: () => QueryBuilder;
  then: <TResult1 = QueryResponse, TResult2 = never>(
    onfulfilled?: ((value: QueryResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) => PromiseLike<TResult1 | TResult2>;
};

const state = vi.hoisted(() => ({
  userId: "tracker-a",
  clubs: [{ id: "club-a", name: "Club A" }] as Array<{ id: string; name: string }>,
  scopeRequest: null as ((userId: string) => Promise<{ data: string[] | null; error: unknown | null }>) | null,
  rpc: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: state.userId }, loading: false, isAdmin: false,
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (_name: string, args: { _user_id: string }) => state.scopeRequest
      ? state.scopeRequest(args._user_id)
      : state.rpc(args._user_id),
    from: () => {
      const query = {} as QueryBuilder;
      query.select = () => query;
      query.in = () => query;
      query.then = (onfulfilled, onrejected) => Promise.resolve({
        data: state.clubs,
        error: null,
      }).then(onfulfilled, onrejected);
      return { select: () => query };
    },
  },
}));
vi.mock("@/components/cashier/TournamentLivePanel", () => ({
  default: () => <div data-testid="tracker-live-panel" />,
}));

import TrackerDashboard from "./TrackerDashboard";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

function renderTracker() {
  return render(<MemoryRouter initialEntries={["/tracker"]}><Routes>
    <Route path="/tracker" element={<TrackerDashboard />} />
  </Routes></MemoryRouter>);
}

describe("TrackerDashboard club read state", () => {
  beforeEach(() => {
    state.userId = "tracker-a";
    state.clubs = [{ id: "club-a", name: "Club A" }];
    state.scopeRequest = null;
    state.rpc.mockReset();
    state.rpc.mockResolvedValue({ data: ["club-a"], error: null });
  });

  it("turns a thrown fetch failure into a retryable error instead of an endless skeleton or empty permission", async () => {
    state.rpc.mockRejectedValue(new TypeError("Failed to fetch"));
    renderTracker();

    expect(await screen.findByText("Không kết nối được máy chủ. Kiểm tra mạng rồi thử tải lại.")).toBeInTheDocument();
    expect(screen.queryByText("Bạn chưa được phân công CLB nào")).not.toBeInTheDocument();
    expect(state.rpc).toHaveBeenCalledTimes(3);

    state.rpc.mockResolvedValue({ data: [], error: null });
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText("Bạn chưa được phân công CLB nào")).toBeInTheDocument();
  });

  it("does not let an earlier user's scope response replace the active user's clubs", async () => {
    const oldScope = deferred<{ data: string[]; error: null }>();
    state.userId = "tracker-old";
    state.clubs = [{ id: "club-b", name: "Club B" }];
    state.scopeRequest = (userId) => userId === "tracker-old"
      ? oldScope.promise
      : Promise.resolve({ data: ["club-b"], error: null });
    const view = renderTracker();

    state.userId = "tracker-new";
    view.rerender(<MemoryRouter initialEntries={["/tracker"]}><Routes>
      <Route path="/tracker" element={<TrackerDashboard />} />
    </Routes></MemoryRouter>);

    expect(await screen.findByText("Club B")).toBeInTheDocument();
    await act(async () => { oldScope.resolve({ data: ["club-a"], error: null }); });
    expect(screen.queryByText("Club A")).not.toBeInTheDocument();
  });

  it("does not present a partial club catalog as a verified scope", async () => {
    state.rpc.mockResolvedValue({ data: ["club-a", "club-missing"], error: null });
    renderTracker();

    expect(await screen.findByText("Quyền CLB đã được xác nhận nhưng thông tin CLB không khớp. Cần kiểm tra dữ liệu.")).toBeInTheDocument();
    expect(screen.queryByTestId("tracker-live-panel")).not.toBeInTheDocument();
  });

});
