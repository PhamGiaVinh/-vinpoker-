import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();
const invokeMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
  },
}));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { payrollStatementTelegramDeliveryAllClubs: false } }));

import { usePayrollStatementTelegramDelivery } from "@/hooks/usePayrollStatementTelegramDelivery";

const club = "22222222-2222-2222-2222-222222222222";
const period = "33333333-3333-4333-8333-333333333333";
const operation = {
  operation_id: "44444444-4444-4444-8444-444444444444",
  state: "completed",
  pending_count: 0, sending_count: 0, sent_count: 2, failed_count: 0, unknown_count: 0,
  skipped_count: 1, telegram_unlinked_count: 1, pdf_not_ready_count: 0, total_count: 3,
};
const rolloutOn = {
  allowed: true, master_enabled: true, statement_rollout_allowed: true,
  all_clubs_enabled: false, allowlisted: true, reason: "ENABLED",
};

describe("usePayrollStatementTelegramDelivery", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    invokeMock.mockReset();
    sessionStorage.clear();
  });

  it("is blocked when the server rollout is off", async () => {
    rpcMock.mockResolvedValueOnce({ data: { ...rolloutOn, allowed: false, reason: "MASTER_OFF" }, error: null });
    const { result } = renderHook(() => usePayrollStatementTelegramDelivery({ clubId: club, periodId: period, canSend: true }));
    await waitFor(() => expect(result.current.availability).toBe("blocked"));
    await act(async () => expect(await result.current.sendAll()).toBeNull());
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("creates one operation intent and reconciles the Edge response", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: rolloutOn, error: null })
      .mockResolvedValueOnce({ data: operation, error: null });
    invokeMock.mockResolvedValueOnce({ data: { operation }, error: null });
    const { result } = renderHook(() => usePayrollStatementTelegramDelivery({ clubId: club, periodId: period, canSend: true }));
    await waitFor(() => expect(result.current.availability).toBe("ready"));
    await act(async () => expect((await result.current.sendAll())?.sent_count).toBe(2));
    expect(rpcMock).toHaveBeenLastCalledWith("create_dealer_payroll_statement_delivery_operation_v2", expect.objectContaining({
      p_club_id: club,
      p_payroll_period_id: period,
    }));
    expect(invokeMock).toHaveBeenCalledWith("send-payroll-statement", { body: { operation_id: operation.operation_id } });
  });

  it("fails closed after an uncertain Edge response and failed reconciliation", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: rolloutOn, error: null })
      .mockResolvedValueOnce({ data: operation, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "NETWORK" } });
    invokeMock.mockResolvedValueOnce({ data: null, error: { message: "timeout" } });
    const { result } = renderHook(() => usePayrollStatementTelegramDelivery({ clubId: club, periodId: period, canSend: true }));
    await waitFor(() => expect(result.current.availability).toBe("ready"));
    await act(async () => expect(await result.current.sendAll()).toBeNull());
    expect(result.current.error).toContain("Không xác nhận");
  });

  it("continues a resumed operation across bounded Edge batches", async () => {
    const pending = { ...operation, state: "ready", pending_count: 50, sent_count: 50, total_count: 100, resumed: true };
    rpcMock
      .mockResolvedValueOnce({ data: rolloutOn, error: null })
      .mockResolvedValueOnce({ data: pending, error: null });
    invokeMock
      .mockResolvedValueOnce({ data: { operation: pending }, error: null })
      .mockResolvedValueOnce({ data: { operation }, error: null });
    const { result } = renderHook(() => usePayrollStatementTelegramDelivery({ clubId: club, periodId: period, canSend: true }));
    await waitFor(() => expect(result.current.availability).toBe("ready"));
    await act(async () => expect((await result.current.sendAll())?.state).toBe("completed"));
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenNthCalledWith(1, "send-payroll-statement", { body: { operation_id: operation.operation_id } });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "send-payroll-statement", { body: { operation_id: operation.operation_id } });
  });
});
