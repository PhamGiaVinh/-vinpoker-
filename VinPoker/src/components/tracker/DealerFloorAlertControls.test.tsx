import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRpc = vi.hoisted(() => vi.fn());
const handRevision = vi.hoisted(() => ({ value: 7 }));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: mockRpc,
  from: vi.fn(() => {
    const query = {
      eq: () => query,
      maybeSingle: async () => ({ data: { id: "hand", source_revision: handRevision.value }, error: null }),
      then: (resolve: (value: unknown) => void) => resolve({ data: [], error: null }),
    };
    return { select: () => query };
  }),
} }));
import { supabase } from "@/integrations/supabase/client";
import { DealerFloorAlertControls } from "./DealerFloorAlertControls";

const props = { tournamentId: "tournament", tournamentTableId: "table", handId: "hand", enabled: true };

beforeEach(() => {
  mockRpc.mockReset();
  handRevision.value = 7;
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
    mockRpc.mockImplementation((async (_name, args: { p_request_id: string }) => ({
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
    mockRpc.mockImplementation((async (_name, args: { p_request_id: string }) => ({
      data: { ok: true, alert_id: "alert-1", request_id: args.p_request_id }, error: null,
    })) as never);
    render(<DealerFloorAlertControls {...props} handId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Gọi Floor" }));
    await screen.findByText(/Đã gửi Floor/);
    expect(supabase.rpc).toHaveBeenCalledWith("report_tracker_floor_operational_alert_v2", expect.objectContaining({
      p_hand_id: null, p_action_id: null,
    }));
  });

  it("reports the whole hand without forcing the operator to select an action", async () => {
    mockRpc.mockImplementation((async (_name, args: { p_request_id: string }) => ({
      data: { ok: true, alert_id: "alert-1", request_id: args.p_request_id }, error: null,
    })) as never);
    render(<DealerFloorAlertControls {...props} />);
    const reportButton = screen.getByRole("button", { name: "Báo sai hand" });
    await waitFor(() => expect(reportButton.hasAttribute("disabled")).toBe(false));
    fireEvent.click(reportButton);
    await screen.findByText(/Đã gửi Floor/);
    expect(supabase.rpc).toHaveBeenCalledWith("report_tracker_wrong_hand_v1", expect.objectContaining({
      p_hand_id: "hand", p_expected_source_revision: 7,
    }));
  });

  it("requires an active hand before reporting a wrong hand", async () => {
    mockRpc.mockImplementation((async (_name, args: { p_request_id: string }) => ({
      data: { ok: true, alert_id: "alert-1", request_id: args.p_request_id, correction_pending: true }, error: null,
    })) as never);
    render(<DealerFloorAlertControls {...props} handId={null} />);
    expect(screen.getByRole("button", { name: "Báo sai hand" }).hasAttribute("disabled")).toBe(true);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("reloads the source revision and asks for review after a stale report", async () => {
    mockRpc
      .mockImplementationOnce(async () => {
        handRevision.value = 8;
        return { data: { ok: false, error: "stale_source_revision" }, error: null } as never;
      })
      .mockImplementationOnce((async (_name, args: { p_request_id: string }) => ({
        data: { ok: true, alert_id: "alert-2", request_id: args.p_request_id }, error: null,
      })) as never);
    render(<DealerFloorAlertControls {...props} />);
    const reportButton = screen.getByRole("button", { name: "Báo sai hand" });
    await waitFor(() => expect(reportButton.hasAttribute("disabled")).toBe(false));

    fireEvent.click(reportButton);

    await screen.findByText(/Hand đã thay đổi trên máy chủ.*Đã tải phiên bản mới/i);
    expect(window.sessionStorage.length).toBe(0);
    await waitFor(() => expect(reportButton.hasAttribute("disabled")).toBe(false));
    fireEvent.click(reportButton);
    await screen.findByText(/Đã gửi Floor/);
    expect(mockRpc.mock.calls[1][1]).toEqual(expect.objectContaining({
      p_expected_source_revision: 8,
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
    mockRpc.mockRejectedValueOnce(new Error("network lost"));
    const { unmount } = render(<DealerFloorAlertControls {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Vấn đề hiển thị" }));
    await screen.findByText(/Chưa biết máy chủ đã nhận chưa/);
    const firstCall = mockRpc.mock.calls[0][1] as { p_request_id: string };
    expect(window.sessionStorage.length).toBe(1);
    unmount();

    mockRpc.mockImplementation((async (_name, args: { p_request_id: string }) => ({
      data: { ok: true, alert_id: "alert-1", request_id: args.p_request_id }, error: null,
    })) as never);
    render(<DealerFloorAlertControls {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra lại yêu cầu đang chờ" }));
    await waitFor(() => expect(screen.getByText(/Đã gửi Floor/)).toBeTruthy());
    const retry = mockRpc.mock.calls[1][1] as { p_request_id: string; p_kind: string };
    expect(retry.p_request_id).toBe(firstCall.p_request_id);
    expect(retry.p_kind).toBe("display_issue");
    expect(window.sessionStorage.length).toBe(0);
  });

  it("retries a whole-hand report with the same request and revision after response loss", async () => {
    mockRpc.mockRejectedValueOnce(new Error("response lost"));
    const { unmount } = render(<DealerFloorAlertControls {...props} />);
    const reportButton = screen.getByRole("button", { name: "Báo sai hand" });
    await waitFor(() => expect(reportButton.hasAttribute("disabled")).toBe(false));
    fireEvent.click(reportButton);
    await screen.findByText(/Chưa biết máy chủ đã nhận chưa/);
    const first = mockRpc.mock.calls[0][1] as {
      p_request_id: string;
      p_expected_source_revision: number;
    };
    unmount();

    mockRpc.mockImplementationOnce((async (_name, args: { p_request_id: string }) => ({
      data: { ok: true, duplicate: true, alert_id: "alert-1", request_id: args.p_request_id }, error: null,
    })) as never);
    render(<DealerFloorAlertControls {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra lại yêu cầu đang chờ" }));
    await screen.findByText(/Đã gửi Floor/);
    const retry = mockRpc.mock.calls[1][1] as {
      p_request_id: string;
      p_expected_source_revision: number;
    };
    expect(retry).toEqual(expect.objectContaining({
      p_request_id: first.p_request_id,
      p_expected_source_revision: first.p_expected_source_revision,
    }));
  });

  it.each(["tracker_lock_not_owned", "actor_not_allowed"])("retains an uncertain request after %s before retry", async (reason) => {
    mockRpc.mockRejectedValueOnce(new Error("network lost"));
    render(<DealerFloorAlertControls {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Gọi Floor" }));
    await screen.findByText(/Chưa biết máy chủ đã nhận chưa/);
    const firstCall = mockRpc.mock.calls[0][1] as { p_request_id: string };

    mockRpc.mockResolvedValueOnce({
      data: { ok: false, error: reason }, error: null,
    } as never);
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra lại yêu cầu đang chờ" }));
    await screen.findByText(/Không còn quyền xác minh yêu cầu cũ/);
    expect(screen.getByText(`Mã yêu cầu: ${firstCall.p_request_id}`)).toBeTruthy();
    expect(window.sessionStorage.length).toBe(1);
    expect(screen.getByRole("button", { name: "Gọi Floor" }).hasAttribute("disabled")).toBe(true);
  });
});
