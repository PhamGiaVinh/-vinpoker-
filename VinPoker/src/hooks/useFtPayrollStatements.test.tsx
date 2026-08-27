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

const onlinePreview = {
  view: {
    statement_id: "55555555-5555-4555-8555-555555555555",
    statement_hash: "a".repeat(64),
    draft: true,
    brand_name: "VINPOKER",
    club_name: "HSOP",
    period_label: "Tháng 08/2026",
    dealer: { full_name: "Nguyễn Minh Anh", department: "Dealer", job_title: "Dealer", bank_account_number: "0338356589", bank_name: "VPBank", hire_date: "15/04/2024", employment_type: "Chính thức" },
    metrics: [], income_lines: [], rate_segments: [], deduction_lines: [],
    gross_amount: "0", deduction_amount: "0", net_amount: "0", finalized_label: "—",
  },
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

  it("requests a server-built online draft view without passing payroll values", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: rolloutOn, error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    invokeMock.mockResolvedValueOnce({ data: onlinePreview, error: null });
    const { result } = renderHook(() => useFtPayrollStatements({
      clubId: hsop,
      periodId: period,
      periodStatus: "locked",
      canFinalize: true,
      dealerIds: [dealer],
    }));
    await waitFor(() => expect(result.current.availability).toBe("ready"));
    await expect(result.current.previewDraft(dealer)).resolves.toMatchObject({ draft: true, club_name: "HSOP" });
    expect(invokeMock).toHaveBeenCalledWith("render-payroll-statement", {
      body: { mode: "preview_ft_view", club_id: hsop, dealer_id: dealer, payroll_period_id: period },
    });
  });
});
