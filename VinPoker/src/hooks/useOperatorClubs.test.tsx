import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: { user: { id: "owner-1", email: "owner@example.test" }, loading: false },
  rpc: vi.fn(),
  clubIn: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: h.rpc,
    from: () => ({ select: () => ({ in: h.clubIn }) }),
  },
}));

import { useOperatorClubs } from "./useOperatorClubs";

describe("useOperatorClubs auth refresh stability", () => {
  beforeEach(() => {
    h.auth = { user: { id: "owner-1", email: "owner@example.test" }, loading: false };
    h.rpc.mockReset();
    h.clubIn.mockReset();
    h.rpc.mockImplementation(async (name: string) => name === "get_my_floor_operator_scope"
      ? { data: [{ club_id: "club-1", can_owner: true, can_cashier: true, can_floor: true }], error: null }
      : { data: [], error: null });
    h.clubIn.mockResolvedValue({ data: [{ id: "club-1", name: "Centerpoint" }], error: null });
  });

  it("keeps Floor scope loaded when Supabase replaces the User object for the same actor", async () => {
    const { result, rerender } = renderHook(() => useOperatorClubs());

    await waitFor(() => expect(result.current.clubs).toEqual([{ id: "club-1", name: "Centerpoint" }]));
    expect(h.rpc).toHaveBeenCalledTimes(2);

    h.auth = { user: { id: "owner-1", email: "refreshed@example.test" }, loading: false };
    rerender();

    expect(result.current.clubs).toEqual([{ id: "club-1", name: "Centerpoint" }]);
    expect(h.rpc).toHaveBeenCalledTimes(2);
  });
});
