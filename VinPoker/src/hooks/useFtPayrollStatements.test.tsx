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
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { payrollStatementPdfAllClubs: false } }));

import { useFtPayrollStatements } from "@/hooks/useFtPayrollStatements";

const hsop = "22222222-2222-2222-2222-222222222222";
const period = "33333333-3333-4333-8333-333333333333";
const dealer = "44444444-4444-4444-8444-444444444444";

const rolloutOn = {
  allowed: true,
  master_enabled: true,
  all_clubs_enabled: false,
  allowlisted: true,
  reason: "ENABLED",
};

describe("useFtPayrollStatements", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    invokeMock.mockReset();
    sessionStorage.clear();
  });

  it("fails closed when rollout cannot be verified", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
    const { result } = renderHook(() => useFtPayrollStatements({
      clubId: hsop,
      periodId: period,
      periodStatus: "locked",
      canFinalize: true,
      dealerIds: [dealer],
    }));
    await waitFor(() => expect(result.current.availability).toBe("unknown"));
    expect(result.current.statusFor(dealer)).toBe("UNKNOWN");
    expect(result.current.canFinalize).toBe(false);
  });

  it("treats a successful empty list as draft", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: rolloutOn, error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    const { result } = renderHook(() => useFtPayrollStatements({
      clubId: hsop,
      periodId: period,
      periodStatus: "locked",
      canFinalize: true,
      dealerIds: [dealer],
    }));
    await waitFor(() => expect(result.current.availability).toBe("ready"));
    expect(result.current.statusFor(dealer)).toBe("DRAFT");
    expect(result.current.counts.draft).toBe(1);
  });

  it("does not call finalize for a cashier-only actor", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: rolloutOn, error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    const { result } = renderHook(() => useFtPayrollStatements({
      clubId: hsop,
      periodId: period,
      periodStatus: "locked",
      canFinalize: false,
      dealerIds: [dealer],
    }));
    await waitFor(() => expect(result.current.availability).toBe("ready"));
    rpcMock.mockClear();
    await act(async () => expect(await result.current.finalize(dealer)).toBe(false));
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("turns an uncertain finalize and failed reconciliation into UNKNOWN", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: rolloutOn, error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    const { result } = renderHook(() => useFtPayrollStatements({
      clubId: hsop,
      periodId: period,
      periodStatus: "locked",
      canFinalize: true,
      dealerIds: [dealer],
    }));
    await waitFor(() => expect(result.current.availability).toBe("ready"));
    rpcMock
      .mockResolvedValueOnce({ data: null, error: { code: "TIMEOUT" } })
      .mockResolvedValueOnce({ data: null, error: { code: "NETWORK" } });
    await act(async () => { await result.current.finalize(dealer); });
    expect(result.current.statusFor(dealer)).toBe("UNKNOWN");
  });
});
