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

import { usePtPayrollStatements } from "@/hooks/usePtPayrollStatements";

const club = "22222222-2222-2222-2222-222222222222";
const period = "33333333-3333-4333-8333-333333333333";
const dealer = "44444444-4444-4444-8444-444444444444";
const statementId = "55555555-5555-4555-8555-555555555555";

const rolloutOn = {
  allowed: true,
  master_enabled: true,
  all_clubs_enabled: false,
  allowlisted: true,
  reason: "ENABLED",
};

const statement = {
  statement_id: statementId,
  dealer_id: dealer,
  state: "finalized",
  statement_version: 1,
  statement_hash: "a".repeat(64),
  source_fingerprint: "b".repeat(64),
  finalized_at: "2026-09-01T00:00:00.000Z",
  pdf_status: "not_generated",
  pdf_failure_code: null,
  pdf_rendered_at: null,
};

const onlinePreview = {
  view: {
    statement_id: statementId,
    statement_hash: "a".repeat(64),
    draft: true,
    brand_name: "VINPOKER",
    club_name: "HSOP",
    period_label: "Tháng 09/2026",
    dealer: {
      full_name: "Anh Dũng",
      department: "Dealer",
      job_title: "Dealer",
      bank_account_number: "",
      bank_name: "",
      hire_date: "",
      employment_type: "Bán thời gian",
    },
    metrics: [],
    income_lines: [],
    rate_segments: [],
    deduction_lines: [],
    gross_amount: "800.000 đ",
    deduction_amount: "0 đ",
    net_amount: "800.000 đ",
    finalized_label: "—",
  },
};

describe("usePtPayrollStatements", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    invokeMock.mockReset();
    sessionStorage.clear();
  });

  it("fails closed when PT rollout cannot be verified", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
    const { result } = renderHook(() => usePtPayrollStatements({
      clubId: club,
      periodId: period,
      periodStatus: "locked",
      canFinalize: true,
      dealerIds: [dealer],
    }));
    await waitFor(() => expect(result.current.availability).toBe("unknown"));
    expect(result.current.statusFor(dealer)).toBe("UNKNOWN");
    expect(result.current.canFinalize).toBe(false);
  });

  it("previews PT from server intent IDs without client payroll values", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: rolloutOn, error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    invokeMock.mockResolvedValueOnce({ data: onlinePreview, error: null });
    const { result } = renderHook(() => usePtPayrollStatements({
      clubId: club,
      periodId: period,
      periodStatus: "locked",
      canFinalize: true,
      dealerIds: [dealer],
    }));
    await waitFor(() => expect(result.current.availability).toBe("ready"));
    await expect(result.current.previewDraft(dealer)).resolves.toMatchObject({ draft: true, club_name: "HSOP" });
    expect(invokeMock).toHaveBeenCalledWith("render-payroll-statement", {
      body: { mode: "preview_pt_view", club_id: club, dealer_id: dealer, payroll_period_id: period },
    });
  });

  it("does not finalize when the actor only has view permission", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: rolloutOn, error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    const { result } = renderHook(() => usePtPayrollStatements({
      clubId: club,
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

  it("turns an uncertain PT finalize and failed reconciliation into UNKNOWN", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: rolloutOn, error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    const { result } = renderHook(() => usePtPayrollStatements({
      clubId: club,
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

  it("bulk prepares immutable PT PDFs without invoking Telegram or payout", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: rolloutOn, error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    const { result } = renderHook(() => usePtPayrollStatements({
      clubId: club,
      periodId: period,
      periodStatus: "locked",
      canFinalize: true,
      dealerIds: [dealer],
    }));
    await waitFor(() => expect(result.current.availability).toBe("ready"));
    rpcMock
      .mockResolvedValueOnce({
        data: { finalized_count: 1, existing_count: 0, skipped_count: 0, failed_count: 0 },
        error: null,
      })
      .mockResolvedValueOnce({ data: [statement], error: null })
      .mockResolvedValueOnce({ data: [{ ...statement, state: "pdf_rendered", pdf_status: "ready", pdf_rendered_at: "2026-09-01T00:01:00.000Z" }], error: null });
    invokeMock.mockResolvedValueOnce({
      data: { download_url: "https://signed.invalid/opaque", download_filename: `phieu-luong-092026-${statementId}.pdf` },
      error: null,
    });

    await act(async () => expect(await result.current.prepareAll()).toMatchObject({ finalized: 1, pdfReady: 1, pdfFailed: 0 }));
    expect(rpcMock).toHaveBeenCalledWith("finalize_part_time_payroll_statements_for_period", expect.objectContaining({
      p_club_id: club,
      p_payroll_period_id: period,
    }));
    expect(invokeMock).toHaveBeenCalledWith("render-payroll-statement", { body: { mode: "final", statement_id: statementId } });
    expect(invokeMock).not.toHaveBeenCalledWith("send-payroll-statement", expect.anything());
    expect(rpcMock.mock.calls.flat().join(" ")).not.toContain("pay_finalized_part_time_payroll_statement");
  });
});
