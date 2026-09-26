import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { actionRows } = vi.hoisted(() => ({ actionRows: { value: [] as Record<string, unknown>[] } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: vi.fn(),
  from: vi.fn((table: string) => {
    const query = {
      eq: () => query,
      order: async () => ({ data: actionRows.value, error: null }),
      maybeSingle: async () => ({ data: { id: "hand", source_revision: 7 }, error: null }),
      then: (resolve: (value: unknown) => void) => resolve({ data: table === "hand_players"
        ? [{ player_id: "player-1", entry_number: 1, seat_number: 4 }] : [], error: null }),
    };
    return { select: () => query };
  }),
} }));
import { supabase } from "@/integrations/supabase/client";
import { DealerFloorAlertControls } from "./DealerFloorAlertControls";

const props = { tournamentId: "tournament", tournamentTableId: "table", handId: "hand", enabled: true };

beforeEach(() => {
  vi.mocked(supabase.rpc).mockReset();
  window.sessionStorage.clear();
  actionRows.value = [];
});
afterEach(cleanup);

describe("Dealer Floor operational alert", () => {
  it("does not contact the server before the capability is enabled", () => {
    render(<DealerFloorAlertControls {...props} enabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Gọi Floor" }));
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("sends from manual mode without Voice and requires a matching receipt", async () => {
    vi.mocked(supabase.rpc).mockImplementation((async (_name, args: { p_request_id: string }) => ({
      data: { ok: true, alert_id: "alert-1", request_id: args.p_request_id }, error: null,
    })) as never);
    render(<DealerFloorAlertControls {...props} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Gọi Floor" }));
    await screen.findByText(/Đã gửi Floor/);
    expect(supabase.rpc).toHaveBeenCalledWith("report_tracker_floor_operational_alert_v2", expect.objectContaining({
      p_kind: "call_floor", p_hand_id: "hand", p_action_id: null, p_message: "",
    }));
    expect(window.sessionStorage.length).toBe(0);
  });

  it("supports a table-level request before any hand starts", async () => {
    vi.mocked(supabase.rpc).mockImplementation((async (_name, args: { p_request_id: string }) => ({
      data: { ok: true, alert_id: "alert-1", request_id: args.p_request_id }, error: null,
    })) as never);
    render(<DealerFloorAlertControls {...props} handId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Gọi Floor" }));
    await screen.findByText(/Đã gửi Floor/);
    expect(supabase.rpc).toHaveBeenCalledWith("report_tracker_floor_operational_alert_v2", expect.objectContaining({
      p_hand_id: null, p_action_id: null,
    }));
  });

  it("sends the selected canonical action ID and source revision", async () => {
    actionRows.value = [{ id: "action-1", hand_id: "hand", action_order: 3, street: "preflop", player_id: "player-1", entry_number: 1, action_type: "call", action_amount: 100000 }];
    vi.mocked(supabase.rpc).mockImplementation((async (_name, args: { p_request_id: string }) => ({
      data: { ok: true, alert_id: "alert-1", request_id: args.p_request_id }, error: null,
    })) as never);
    render(<DealerFloorAlertControls {...props} />);
    fireEvent.click(await screen.findByText("Chọn action đã lưu"));
    fireEvent.click(await screen.findByRole("button", { name: /#3 · preflop · Ghế 4 · call/ }));
    fireEvent.click(screen.getByRole("button", { name: "Gọi Floor" }));
    await screen.findByText(/Đã gửi Floor/);
    expect(supabase.rpc).toHaveBeenCalledWith("report_tracker_floor_operational_alert_v2", expect.objectContaining({
      p_action_id: "action-1", p_source_revision: 7,
      p_expected_action: expect.objectContaining({ id: "action-1", action_order: 3, action_type: "call" }),
    }));
  });

  it("does not send when the request key cannot be retained", () => {
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    try {
      render(<DealerFloorAlertControls {...props} />);
      fireEvent.click(screen.getByRole("button", { name: "Gọi Floor" }));
      expect(screen.getByText(/Chưa gửi yêu cầu: không lưu được mã/)).toBeTruthy();
      expect(supabase.rpc).not.toHaveBeenCalled();
    } finally {
      storage.mockRestore();
    }
  });

  it("keeps the same request after an uncertain response and reload", async () => {
    vi.mocked(supabase.rpc).mockRejectedValueOnce(new Error("network lost"));
    const { unmount } = render(<DealerFloorAlertControls {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Vấn đề hiển thị" }));
    await screen.findByText(/Chưa biết máy chủ đã nhận chưa/);
    const firstCall = vi.mocked(supabase.rpc).mock.calls[0][1] as { p_request_id: string };
    expect(window.sessionStorage.length).toBe(1);
    unmount();

    vi.mocked(supabase.rpc).mockImplementation((async (_name, args: { p_request_id: string }) => ({
      data: { ok: true, alert_id: "alert-1", request_id: args.p_request_id }, error: null,
    })) as never);
    render(<DealerFloorAlertControls {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra lại yêu cầu đang chờ" }));
    await waitFor(() => expect(screen.getByText(/Đã gửi Floor/)).toBeTruthy());
    const retry = vi.mocked(supabase.rpc).mock.calls[1][1] as { p_request_id: string; p_kind: string };
    expect(retry.p_request_id).toBe(firstCall.p_request_id);
    expect(retry.p_kind).toBe("display_issue");
    expect(window.sessionStorage.length).toBe(0);
  });

  it.each(["dealer_assignment_not_unique", "dealer_assignment_changed"])("retains an uncertain request after %s before retry", async (reason) => {
    vi.mocked(supabase.rpc).mockRejectedValueOnce(new Error("network lost"));
    render(<DealerFloorAlertControls {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Gọi Floor" }));
    await screen.findByText(/Chưa biết máy chủ đã nhận chưa/);
    const firstCall = vi.mocked(supabase.rpc).mock.calls[0][1] as { p_request_id: string };

    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: { ok: false, error: reason }, error: null,
    } as never);
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra lại yêu cầu đang chờ" }));
    await screen.findByText(/Không còn quyền xác minh yêu cầu cũ/);
    expect(screen.getByText(`Mã yêu cầu: ${firstCall.p_request_id}`)).toBeTruthy();
    expect(window.sessionStorage.length).toBe(1);
    expect(screen.getByRole("button", { name: "Gọi Floor" }).hasAttribute("disabled")).toBe(true);
  });
});
