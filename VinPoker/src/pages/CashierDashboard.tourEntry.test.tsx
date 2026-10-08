import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  userId: "cashier-a",
  clubs: [{ id: "club-a", name: "Club A" }] as Array<{ id: string; name: string }>,
  scopeError: null as { message: string } | null,
  clubError: null as { message: string } | null,
  scopeRequest: null as ((userId: string) => Promise<{ data: string[] | null; error: { message: string } | null }>) | null,
}));

type MockQueryResult = { data: unknown[]; count: number; error: { message: string } | null };
type MockQuery = {
  select: () => MockQuery;
  in: () => MockQuery;
  eq: () => MockQuery;
  gte: () => MockQuery;
  limit: () => Promise<MockQueryResult>;
  then: <TResult1 = MockQueryResult, TResult2 = never>(
    onfulfilled?: ((value: MockQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) => PromiseLike<TResult1 | TResult2>;
};

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: mock.userId }, loading: false, isAdmin: false, isCashier: true }),
}));
vi.mock("@/lib/featureFlags", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/featureFlags")>(),
  OPS_TOUR_CASHIER_ENABLED: true,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (_name: string, args: { _user_id: string }) => mock.scopeRequest
      ? mock.scopeRequest(args._user_id)
      : Promise.resolve({ data: mock.clubs.map((club) => club.id), error: mock.scopeError }),
    from: (table: string) => {
      let result: MockQueryResult = { data: [], count: 0, error: null };
      if (table === "clubs") result = { data: mock.clubs, count: 0, error: mock.clubError };
      const query = {} as MockQuery;
      query.select = () => query;
      query.in = () => query;
      query.eq = () => query;
      query.gte = () => query;
      query.limit = () => Promise.resolve({ data: [], count: 0, error: null });
      query.then = (onfulfilled, onrejected) => Promise.resolve(result).then(onfulfilled, onrejected);
      return { select: () => query };
    },
  },
}));
vi.mock("@/components/DocumentRedirect", () => ({
  DocumentRedirect: ({ to, preserveCurrentLocation }: { to: string; preserveCurrentLocation: boolean }) => (
    <div data-testid="document-redirect" data-preserve={String(preserveCurrentLocation)}>{to}</div>
  ),
}));

import CashierDashboard from "./CashierDashboard";

describe("Cashier tour entry", () => {
  beforeEach(() => {
    mock.userId = "cashier-a";
    mock.clubs = [{ id: "club-a", name: "Club A" }];
    mock.scopeError = null;
    mock.clubError = null;
    mock.scopeRequest = null;
  });

  it("sends a saved legacy buy-in link to the scoped tour counter", async () => {
    render(<MemoryRouter initialEntries={["/cashier?tab=offline_buyin"]}><Routes>
      <Route path="/cashier" element={<CashierDashboard />} />
    </Routes></MemoryRouter>);
    expect(await screen.findByText("/ops/cashier/tour?club=club-a")).toBeInTheDocument();
    expect(screen.getByTestId("document-redirect")).toHaveAttribute("data-preserve", "false");
  });

  it("asks a multi-club cashier to select a workspace instead of guessing a club", async () => {
    mock.clubs = [{ id: "club-a", name: "Club A" }, { id: "club-b", name: "Club B" }];
    render(<MemoryRouter initialEntries={["/cashier?tab=offline_buyin"]}><Routes>
      <Route path="/cashier" element={<CashierDashboard />} />
    </Routes></MemoryRouter>);
    expect(await screen.findByText("/ops")).toBeInTheDocument();
    expect(screen.getByTestId("document-redirect")).toHaveAttribute("data-preserve", "false");
  });

  it("shows a retryable verification error instead of claiming the cashier has no club", async () => {
    mock.scopeError = { message: "Failed to fetch" };
    render(<MemoryRouter initialEntries={["/cashier"]}><Routes>
      <Route path="/cashier" element={<CashierDashboard />} />
    </Routes></MemoryRouter>);

    expect(await screen.findByText("Chưa xác minh được quyền CLB")).toBeInTheDocument();
    expect(screen.queryByText("Bạn chưa được phân công CLB nào")).not.toBeInTheDocument();

    mock.scopeError = null;
    fireEvent.click(screen.getByRole("button", { name: "Thử tải lại" }));
    expect(await screen.findByText("Cashier CLB")).toBeInTheDocument();
  });

  it("shows an error when authorized club IDs cannot be resolved to club rows", async () => {
    mock.clubError = { message: "Failed to fetch" };
    render(<MemoryRouter initialEntries={["/cashier"]}><Routes>
      <Route path="/cashier" element={<CashierDashboard />} />
    </Routes></MemoryRouter>);

    expect(await screen.findByText("Đã xác nhận quyền CLB nhưng không tải được danh sách. Vui lòng thử lại.")).toBeInTheDocument();
    expect(screen.queryByText("Bạn chưa được phân công CLB nào")).not.toBeInTheDocument();
  });

  it("shows the unassigned state only after a successful empty scope response", async () => {
    mock.clubs = [];
    render(<MemoryRouter initialEntries={["/cashier"]}><Routes>
      <Route path="/cashier" element={<CashierDashboard />} />
    </Routes></MemoryRouter>);

    expect(await screen.findByText("Bạn chưa được phân công CLB nào")).toBeInTheDocument();
    expect(screen.queryByText("Chưa xác minh được quyền CLB")).not.toBeInTheDocument();
  });

  it("does not let an older account response replace the current account's club scope", async () => {
    let resolveOldScope!: (value: { data: string[]; error: null }) => void;
    mock.userId = "cashier-old";
    mock.clubs = [{ id: "club-b", name: "Club B" }];
    mock.scopeRequest = (userId) => userId === "cashier-old"
      ? new Promise((resolve) => { resolveOldScope = resolve; })
      : Promise.resolve({ data: ["club-b"], error: null });

    const view = render(<MemoryRouter initialEntries={["/cashier"]}><Routes>
      <Route path="/cashier" element={<CashierDashboard />} />
    </Routes></MemoryRouter>);

    mock.userId = "cashier-new";
    view.rerender(<MemoryRouter initialEntries={["/cashier"]}><Routes>
      <Route path="/cashier" element={<CashierDashboard />} />
    </Routes></MemoryRouter>);

    expect(await screen.findByText(/Phụ trách: Club B/)).toBeInTheDocument();
    await act(async () => { resolveOldScope({ data: ["club-a"], error: null }); });
    expect(screen.queryByText(/Phụ trách: Club A/)).not.toBeInTheDocument();
  });
});
