import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FEATURES } from "@/lib/featureFlags";
import {
  parsePayrollDeliveryOperation,
  parsePayrollDeliveryRollout,
  type PayrollDeliveryOperation,
} from "@/lib/payrollStatementDelivery";

const HSOP_CLUB_ID = "22222222-2222-2222-2222-222222222222";
const MAX_EDGE_DISPATCHES_PER_ACTION = 20;
type Availability = "legacy" | "loading" | "blocked" | "ready" | "unknown";
type RpcInvoker = (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

function rpc(name: string, args?: Record<string, unknown>) {
  return (supabase.rpc as unknown as RpcInvoker)(name, args);
}

export function usePayrollStatementTelegramDelivery(input: {
  clubId: string;
  periodId: string | null;
  canSend: boolean;
}) {
  const { clubId, periodId, canSend } = input;
  const sourceEligible = clubId === HSOP_CLUB_ID || FEATURES.payrollStatementTelegramDeliveryAllClubs;
  const [availability, setAvailability] = useState<Availability>(sourceEligible ? "loading" : "legacy");
  const [operation, setOperation] = useState<PayrollDeliveryOperation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const currentKey = useRef("");
  currentKey.current = `${clubId}:${periodId ?? "none"}`;

  const readOperation = useCallback(async (operationId: string, expectedKey = currentKey.current) => {
    const response = await rpc("get_dealer_payroll_statement_delivery_operation", { p_operation_id: operationId });
    const parsed = response.error ? null : parsePayrollDeliveryOperation(response.data);
    if (!parsed) return null;
    if (expectedKey === currentKey.current) setOperation(parsed);
    return parsed;
  }, []);

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    const key = currentKey.current;
    setError(null);
    setOperation(null);
    if (!sourceEligible || !clubId || !periodId) {
      setAvailability("legacy");
      return;
    }
    setAvailability("loading");
    const response = await rpc("get_dealer_payroll_statement_delivery_rollout", { p_expected_club_id: clubId });
    if (version !== requestVersion.current || key !== currentKey.current) return;
    if (response.error) {
      // A migration missing before rollout is indistinguishable from a failed
      // safety check to the browser, so the sender stays hidden/fail-closed.
      setAvailability("unknown");
      setError("Không xác minh được quyền gửi Telegram. Hành động gửi đang bị khóa an toàn.");
      return;
    }
    const rollout = parsePayrollDeliveryRollout(response.data);
    if (!rollout) {
      setAvailability("unknown");
      setError("Phản hồi quyền gửi Telegram không hợp lệ. Hành động gửi đang bị khóa an toàn.");
      return;
    }
    setAvailability(rollout.allowed ? "ready" : "blocked");
  }, [clubId, periodId, sourceEligible]);

  useEffect(() => {
    void refresh();
    return () => { requestVersion.current += 1; };
  }, [refresh]);

  const sendAll = useCallback(async () => {
    if (availability !== "ready" || !canSend || !clubId || !periodId) return null;
    const expectedKey = currentKey.current;
    const storageKey = `payroll-statement-delivery-request:${clubId}:${periodId}`;
    const requestId = sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
    sessionStorage.setItem(storageKey, requestId);

    const created = await rpc("create_dealer_payroll_statement_delivery_operation", {
      p_request_id: requestId,
      p_club_id: clubId,
      p_payroll_period_id: periodId,
    });
    const operation = created.error ? null : parsePayrollDeliveryOperation(created.data);
    if (!operation || expectedKey !== currentKey.current) {
      setError("Không xác nhận được đợt gửi. Hệ thống sẽ không tự gửi lại.");
      return null;
    }
    setOperation(operation);

    let next: PayrollDeliveryOperation | null = operation;
    for (let dispatch = 0; dispatch < MAX_EDGE_DISPATCHES_PER_ACTION; dispatch += 1) {
      const { data, error: invokeError } = await supabase.functions.invoke("send-payroll-statement", {
        body: { operation_id: operation.operation_id },
      });
      if (expectedKey !== currentKey.current) return null;
      const response = data && typeof data === "object"
        ? parsePayrollDeliveryOperation((data as Record<string, unknown>).operation)
        : null;
      if (invokeError || !response) break;
      next = response;
      setOperation(next);
      if (next.state !== "ready" || next.pending_count === 0) return next;
    }
    const reconciled = await readOperation(operation.operation_id, expectedKey);
    if (reconciled) return reconciled;
    setError("Không xác nhận được kết quả gửi. Hệ thống không tự gửi lại để tránh trùng phiếu.");
    return null;
  }, [availability, canSend, clubId, periodId, readOperation]);

  return {
    availability,
    operation,
    error,
    canSend: availability === "ready" && canSend,
    refresh,
    sendAll,
  };
}
