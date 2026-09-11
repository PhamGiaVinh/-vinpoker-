import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FEATURES } from "@/lib/featureFlags";
import {
  deriveFtStatementStatus,
  parsePayrollStatementOnlinePreview,
  parseFtStatementRecords,
  parseFtStatementRollout,
  type FtPayrollStatementRecord,
  type FtPayrollStatementStatus,
  type PayrollStatementOnlinePreview,
} from "@/lib/payrollStatementUi";

const HSOP_CLUB_ID = "22222222-2222-2222-2222-222222222222";
const PDF_PREPARE_CONCURRENCY = 4;
type Availability = "legacy" | "loading" | "blocked" | "ready" | "unknown";
type RpcInvoker = (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

export type PtPayrollPrepareSummary = {
  finalized: number;
  existing: number;
  skipped: number;
  failed: number;
  pdfReady: number;
  pdfFailed: number;
};

function rpc(name: string, args?: Record<string, unknown>) {
  return (supabase.rpc as unknown as RpcInvoker)(name, args);
}

export function usePtPayrollStatements(input: {
  clubId: string;
  periodId: string | null;
  periodStatus: string | null;
  canFinalize: boolean;
  dealerIds: string[];
}) {
  const { clubId, periodId, periodStatus, canFinalize, dealerIds } = input;
  const sourceEligible = clubId === HSOP_CLUB_ID || FEATURES.payrollStatementPdfAllClubs;
  const [availability, setAvailability] = useState<Availability>(sourceEligible ? "loading" : "legacy");
  const [records, setRecords] = useState<Record<string, FtPayrollStatementRecord>>({});
  const [overrides, setOverrides] = useState<Record<string, FtPayrollStatementStatus>>({});
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const requestVersion = useRef(0);
  const currentKey = useRef("");
  currentKey.current = `${clubId}:${periodId ?? "none"}`;

  const fetchRecords = useCallback(async (expectedKey = currentKey.current) => {
    if (!sourceEligible || !clubId || !periodId) {
      if (expectedKey === currentKey.current) {
        setRecords({});
        setOverrides({});
      }
      return { ok: true, records: {} as Record<string, FtPayrollStatementRecord> };
    }
    const result = await rpc("list_part_time_payroll_statements_for_period", {
      p_club_id: clubId,
      p_payroll_period_id: periodId,
    });
    if (result.error) return { ok: false, records: {} as Record<string, FtPayrollStatementRecord> };
    const parsed = parseFtStatementRecords(result.data);
    if (!parsed) return { ok: false, records: {} as Record<string, FtPayrollStatementRecord> };
    const next = Object.fromEntries(parsed.map((row) => [row.dealer_id, row]));
    if (expectedKey === currentKey.current) {
      setRecords(next);
      setOverrides({});
      setError(null);
    }
    return { ok: true, records: next };
  }, [clubId, periodId, sourceEligible]);

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    const key = currentKey.current;
    setPreparing(false);
    setError(null);
    if (!sourceEligible || !clubId) {
      setAvailability("legacy");
      setRecords({});
      setOverrides({});
      return;
    }
    setAvailability("loading");
    setRecords({});
    setOverrides({});
    const rolloutResult = await rpc("get_dealer_payroll_statement_rollout", {
      p_expected_club_id: clubId,
    });
    if (version !== requestVersion.current || key !== currentKey.current) return;
    if (rolloutResult.error) {
      setAvailability("unknown");
      setError("Không xác minh được trạng thái phiếu PT. Hành động đã được khóa an toàn.");
      return;
    }
    const rollout = parseFtStatementRollout(rolloutResult.data);
    if (!rollout) {
      setAvailability("unknown");
      setError("Phản hồi rollout phiếu PT không hợp lệ. Hành động đã được khóa an toàn.");
      return;
    }
    if (!rollout.allowed) {
      setAvailability("blocked");
      return;
    }
    const loaded = await fetchRecords(key);
    if (version !== requestVersion.current || key !== currentKey.current) return;
    if (!loaded.ok) {
      setAvailability("unknown");
      setError("Không tải được trạng thái phiếu PT. Không thể xác định phiếu đã chốt hay chưa.");
      return;
    }
    setAvailability("ready");
  }, [clubId, fetchRecords, sourceEligible]);

  useEffect(() => {
    void refresh();
    return () => { requestVersion.current += 1; };
  }, [refresh]);

  const statusFor = useCallback((dealerId: string): FtPayrollStatementStatus => {
    if (availability === "unknown") return "UNKNOWN";
    return deriveFtStatementStatus(records[dealerId], overrides[dealerId]);
  }, [availability, records, overrides]);

  const setOverride = useCallback((dealerId: string, status: FtPayrollStatementStatus) => {
    setOverrides((current) => ({ ...current, [dealerId]: status }));
  }, []);

  const reconcileDealer = useCallback(async (dealerId: string, expectedKey: string) => {
    const loaded = await fetchRecords(expectedKey);
    if (expectedKey !== currentKey.current) return null;
    if (!loaded.ok) {
      setOverride(dealerId, "UNKNOWN");
      return null;
    }
    return loaded.records[dealerId] ?? null;
  }, [fetchRecords, setOverride]);

  const finalize = useCallback(async (dealerId: string) => {
    if (availability !== "ready" || !canFinalize || !periodId || periodStatus !== "locked") return false;
    const expectedKey = currentKey.current;
    const storageKey = `payroll-pt-statement-request:${clubId}:${periodId}:${dealerId}`;
    const requestId = sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
    sessionStorage.setItem(storageKey, requestId);
    setOverride(dealerId, "FINALIZING");
    await rpc("finalize_part_time_payroll_statement_for_period", {
      p_request_id: requestId,
      p_club_id: clubId,
      p_dealer_id: dealerId,
      p_payroll_period_id: periodId,
      p_reason: "Chốt phiếu lương PT từ giao diện Dealer Swing",
    });
    if (expectedKey !== currentKey.current) return false;
    const reconciled = await reconcileDealer(dealerId, expectedKey);
    if (reconciled) {
      sessionStorage.removeItem(storageKey);
      return true;
    }
    setOverride(dealerId, "UNKNOWN");
    return false;
  }, [availability, canFinalize, clubId, periodId, periodStatus, reconcileDealer, setOverride]);

  const invokePdf = useCallback(async (body: Record<string, string>) => {
    const { data, error: invokeError } = await supabase.functions.invoke("render-payroll-statement", { body });
    if (invokeError) throw invokeError;
    return data;
  }, []);

  const previewDraft = useCallback(async (dealerId: string) => {
    if (availability !== "ready" || !periodId) throw new Error("PAYROLL_STATEMENT_UNAVAILABLE");
    const data = await invokePdf({ mode: "preview_pt_view", club_id: clubId, dealer_id: dealerId, payroll_period_id: periodId });
    return onlinePreview(data, true);
  }, [availability, clubId, invokePdf, periodId]);

  const previewFinal = useCallback(async (dealerId: string) => {
    const statement = records[dealerId];
    if (availability !== "ready" || !statement) throw new Error("PAYROLL_STATEMENT_UNAVAILABLE");
    const data = await invokePdf({ mode: "preview_view", statement_id: statement.statement_id });
    return onlinePreview(data, false);
  }, [availability, invokePdf, records]);

  const generatePdf = useCallback(async (dealerId: string) => {
    const statement = records[dealerId];
    if (availability !== "ready" || !statement) throw new Error("PAYROLL_STATEMENT_UNAVAILABLE");
    const expectedKey = currentKey.current;
    setOverride(dealerId, "PDF_GENERATING");
    try {
      const payload = await ensurePdf(invokePdf, statement.statement_id);
      if (expectedKey !== currentKey.current) return false;
      await downloadSignedPdf(payload.download_url, payload.download_filename);
      await reconcileDealer(dealerId, expectedKey);
      return true;
    } catch (cause) {
      if (expectedKey === currentKey.current) await reconcileDealer(dealerId, expectedKey);
      throw cause;
    }
  }, [availability, invokePdf, reconcileDealer, records, setOverride]);

  const prepareAll = useCallback(async (): Promise<PtPayrollPrepareSummary | null> => {
    if (availability !== "ready" || !canFinalize || !periodId || periodStatus !== "locked" || preparing) return null;
    const expectedKey = currentKey.current;
    const storageKey = `payroll-pt-bulk-request:${clubId}:${periodId}`;
    const requestId = sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
    sessionStorage.setItem(storageKey, requestId);
    setPreparing(true);
    setError(null);
    try {
      const response = await rpc("finalize_part_time_payroll_statements_for_period", {
        p_request_id: requestId,
        p_club_id: clubId,
        p_payroll_period_id: periodId,
      });
      if (response.error || !isPrepareResponse(response.data) || expectedKey !== currentKey.current) {
        setError("Không xác nhận được đợt chốt PT. Hãy tải lại trạng thái trước khi thử lại.");
        return null;
      }

      const loaded = await fetchRecords(expectedKey);
      if (!loaded.ok || expectedKey !== currentKey.current) {
        setError("Đã chốt một phần nhưng chưa đối chiếu được trạng thái PDF.");
        return null;
      }
      const toPrepare = Object.values(loaded.records).filter((record) => record.pdf_status !== "ready");
      let pdfReady = Object.values(loaded.records).filter((record) => record.pdf_status === "ready").length;
      let pdfFailed = 0;
      await runBounded(toPrepare, PDF_PREPARE_CONCURRENCY, async (record) => {
        setOverride(record.dealer_id, "PDF_GENERATING");
        try {
          await ensurePdf(invokePdf, record.statement_id);
          pdfReady += 1;
        } catch {
          pdfFailed += 1;
        }
      });
      await fetchRecords(expectedKey);
      sessionStorage.removeItem(storageKey);
      return {
        finalized: response.data.finalized_count,
        existing: response.data.existing_count,
        skipped: response.data.skipped_count,
        failed: response.data.failed_count,
        pdfReady,
        pdfFailed,
      };
    } finally {
      setPreparing(false);
    }
  }, [availability, canFinalize, clubId, fetchRecords, invokePdf, periodId, periodStatus, preparing, setOverride]);

  const counts = useMemo(() => {
    const statuses = dealerIds.map(statusFor);
    return {
      draft: availability === "ready" ? statuses.filter((status) => status === "DRAFT").length : 0,
      finalized: statuses.filter((status) => status === "FINALIZED" || status === "PDF_FAILED").length,
      generating: statuses.filter((status) => status === "PDF_GENERATING").length,
      ready: statuses.filter((status) => status === "PDF_READY").length,
    };
  }, [availability, dealerIds, statusFor]);

  return {
    availability,
    error,
    records,
    counts,
    statusFor,
    refresh,
    finalize,
    previewDraft,
    previewFinal,
    generatePdf,
    prepareAll,
    preparing,
    canFinalize: availability === "ready" && canFinalize && periodStatus === "locked",
  };
}

function isPrepareResponse(value: unknown): value is {
  finalized_count: number;
  existing_count: number;
  skipped_count: number;
  failed_count: number;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return ["finalized_count", "existing_count", "skipped_count", "failed_count"]
    .every((key) => Number.isInteger(row[key]) && Number(row[key]) >= 0);
}

async function ensurePdf(
  invoke: (body: Record<string, string>) => Promise<unknown>,
  statementId: string,
): Promise<{ download_url: string; download_filename: string }> {
  const data = await invoke({ mode: "final", statement_id: statementId });
  if (!data || typeof data !== "object") throw new Error("PAYROLL_PDF_SIGNED_URL_FAILED");
  const payload = data as Record<string, unknown>;
  if (typeof payload.download_url !== "string" || typeof payload.download_filename !== "string") {
    throw new Error("PAYROLL_PDF_SIGNED_URL_FAILED");
  }
  return { download_url: payload.download_url, download_filename: payload.download_filename };
}

async function runBounded<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function downloadSignedPdf(url: string, filename: string) {
  if (!/^phieu-luong-\d{6}-[0-9a-f-]{36}\.pdf$/i.test(filename)) {
    throw new Error("PAYROLL_PDF_INVALID_FILENAME");
  }
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok) throw new Error("PAYROLL_PDF_DOWNLOAD_FAILED");
  const blob = await response.blob();
  if (blob.type && blob.type !== "application/pdf") throw new Error("PAYROLL_PDF_DOWNLOAD_FAILED");
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

function onlinePreview(data: unknown, draft: boolean): PayrollStatementOnlinePreview {
  const preview = parsePayrollStatementOnlinePreview(data);
  if (!preview || preview.draft !== draft) throw new Error("PAYROLL_STATEMENT_PREVIEW_UNAVAILABLE");
  return preview;
}
