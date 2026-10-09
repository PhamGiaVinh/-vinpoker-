import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ user: { id: "owner-a" }, query: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({ select: () => ({
  in: (_column: string, clubs: string[]) => ({ is: () => ({ order: () => state.query(clubs) }) }),
}) }) } }));
import { useAllDealers } from "./useDealerManagement";
beforeEach(() => { vi.clearAllMocks(); state.user = { id: "owner-a" }; });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("Dealer management read scope", () => {
  it("discards a delayed previous-club response", async () => {
    let resolveOld: (value: unknown) => void = () => {};
    state.query.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ data: [{ id: "dealer-b" }], error: null });
    const view = renderHook(({ clubs }) => useAllDealers(clubs), { initialProps: { clubs: ["club-a"] } });
    view.rerender({ clubs: ["club-b"] });
    await waitFor(() => expect(view.result.current.data[0]?.id).toBe("dealer-b"));
    await act(async () => resolveOld({ data: [{ id: "dealer-a" }], error: null }));
    expect(view.result.current.data[0]?.id).toBe("dealer-b");
  });
  it("clears another actor's rows and reports a network failure honestly", async () => {
    state.query.mockResolvedValueOnce({ data: [{ id: "private-dealer-a" }], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "503 unavailable" } });
    const view = renderHook(() => useAllDealers(["club-a"]));
    await waitFor(() => expect(view.result.current.data).toHaveLength(1));
    state.user = { id: "owner-b" }; view.rerender();
    await waitFor(() => expect(view.result.current.error).toBe("503 unavailable"));
    expect(view.result.current.data).toEqual([]);
  });
  it("does not poll a hidden tab", async () => {
    state.query.mockResolvedValue({ data: [], error: null });
    renderHook(() => useAllDealers(["club-a"]));
    await waitFor(() => expect(state.query).toHaveBeenCalledOnce());
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => { vi.advanceTimersByTime(60000); });
    expect(state.query).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });
});
