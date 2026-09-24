import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  clubs: [{ id: "club-a", name: "Club A" }] as Array<{ id: string; name: string }>,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "cashier-a" }, loading: false, isAdmin: false, isCashier: true }),
}));
vi.mock("@/lib/featureFlags", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/featureFlags")>(),
  OPS_TOUR_CASHIER_ENABLED: true,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: mock.clubs.map((club) => club.id), error: null }),
    from: () => ({
      select: () => ({
        in: () => Promise.resolve({ data: mock.clubs, error: null }),
        eq: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
      }),
    }),
  },
}));

import CashierDashboard from "./CashierDashboard";

function Destination() {
  const location = useLocation();
  return <div>{`${location.pathname}${location.search}`}</div>;
}

describe("Cashier tour entry", () => {
  beforeEach(() => { mock.clubs = [{ id: "club-a", name: "Club A" }]; });

  it("sends a saved legacy buy-in link to the scoped tour counter", async () => {
    render(<MemoryRouter initialEntries={["/cashier?tab=offline_buyin"]}><Routes>
      <Route path="/cashier" element={<CashierDashboard />} />
      <Route path="/ops/cashier/tour" element={<Destination />} />
    </Routes></MemoryRouter>);
    expect(await screen.findByText("/ops/cashier/tour?club=club-a")).toBeInTheDocument();
  });

  it("asks a multi-club cashier to select a workspace instead of guessing a club", async () => {
    mock.clubs = [{ id: "club-a", name: "Club A" }, { id: "club-b", name: "Club B" }];
    render(<MemoryRouter initialEntries={["/cashier?tab=offline_buyin"]}><Routes>
      <Route path="/cashier" element={<CashierDashboard />} />
      <Route path="/ops" element={<Destination />} />
    </Routes></MemoryRouter>);
    expect(await screen.findByText("/ops")).toBeInTheDocument();
  });
});
