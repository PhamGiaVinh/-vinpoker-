import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
import { supabase } from "@/integrations/supabase/client";
import { DealerFloorAlertControls } from "./DealerFloorAlertControls";

const props = { tournamentId: "tournament", tournamentTableId: "table", handId: "hand", enabled: true };

beforeEach(() => {
  vi.mocked(supabase.rpc).mockReset();
  window.sessionStorage.clear();
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
    expect(supabase.rpc).toHaveBeenCalledWith("report_tracker_floor_operational_alert", expect.objectContaining({
      p_kind: "call_floor", p_hand_id: "hand", p_action_id: null, p_message: "",
    }));
    expect(window.sessionStorage.length).toBe(0);
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
