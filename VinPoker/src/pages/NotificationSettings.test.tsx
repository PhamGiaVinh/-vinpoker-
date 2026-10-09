import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ read: vi.fn(), select: vi.fn(), update: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "owner-a" } }) }));
vi.mock("@/lib/onesignal", () => ({ isOneSignalSupported: () => false, getSubscriptionState: vi.fn(), requestPushPermission: vi.fn(), optOutPush: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({
  select: (...args: unknown[]) => { state.select(...args); return { eq: () => ({ maybeSingle: state.read }) }; }, update: state.update,
}) } }));
import NotificationSettings from "./NotificationSettings";
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
describe("notification preferences schema availability", () => {
  it("does not let missing email columns break push preferences", async () => {
    state.read.mockResolvedValue({ data: { push_prefs: { news: false } }, error: null });
    render(<NotificationSettings />);
    await screen.findByText(/Tùy chọn email chưa có backend/);
    expect(state.select).toHaveBeenCalledWith("*");
    expect(state.update).not.toHaveBeenCalled();
  });
  it("ends loading and reports a failed read rather than inventing settings", async () => {
    state.read.mockRejectedValue(new Error("503"));
    render(<NotificationSettings />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Không kết nối được");
    expect(state.update).not.toHaveBeenCalled();
  });
});
