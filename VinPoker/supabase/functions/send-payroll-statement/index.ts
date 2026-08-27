import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.2";
import {
  boundedRetryAfterSeconds,
  parsePayrollStatementDeliveryRequest,
  safeTelegramProviderCode,
  sanitizePayrollStatementDeliveryError,
} from "./runtime.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MAX_BODY_BYTES = 4_096;
const BUCKET = "payroll-statements";
const MAX_TARGETS_PER_INVOCATION = 50;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "UNAUTHORIZED" }, 401);
    const parsed = parsePayrollStatementDeliveryRequest(await parseBody(request));
    if (!parsed) return json({ error: "INVALID_REQUEST" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!supabaseUrl || !anonKey || !serviceKey || !botToken) {
      return json({ error: "PAYROLL_DELIVERY_DEPENDENCY_UNAVAILABLE" }, 503);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: userData, error: userError } = await userClient.auth.getUser(authHeader.slice(7));
    if (userError || !userData.user?.id) return json({ error: "UNAUTHORIZED" }, 401);

    // This user-scoped RPC establishes authorization before service-role work begins.
    const { data: operation, error: operationError } = await userClient.rpc(
      "get_dealer_payroll_statement_delivery_operation",
      { p_operation_id: parsed.operation_id },
    );
    if (operationError || !operation) return json({ error: "PAYROLL_DELIVERY_OPERATION_UNAVAILABLE" }, 403);

    let processed = 0;
    let terminalError: string | null = null;
    while (processed < MAX_TARGETS_PER_INVOCATION) {
      const { data: claimData, error: claimError } = await admin.rpc(
        "claim_dealer_payroll_statement_delivery_target",
        { p_operation_id: parsed.operation_id },
      );
      if (claimError || !claimData) {
        terminalError = sanitizePayrollStatementDeliveryError(claimError, "PAYROLL_DELIVERY_CLAIM_FAILED");
        break;
      }
      const claim = claimData as Record<string, unknown>;
      if (claim.claimed !== true) break;

      processed += 1;
      const delivery = await deliverClaimedTarget(admin, botToken, claim);
      if (delivery === "rollout_disabled") {
        terminalError = "PAYROLL_DELIVERY_ROLLOUT_DISABLED";
        break;
      }
    }

    const { data: summary, error: summaryError } = await userClient.rpc(
      "get_dealer_payroll_statement_delivery_operation",
      { p_operation_id: parsed.operation_id },
    );
    if (summaryError || !summary) return json({ error: "PAYROLL_DELIVERY_RECONCILIATION_UNAVAILABLE" }, 503);

    console.info(JSON.stringify({
      component: "payroll_statement_delivery",
      event: "operation_complete",
      processed_count: processed,
      operation_state: (summary as Record<string, unknown>).state ?? "unknown",
      terminal_error: terminalError,
    }));
    return json({ operation: summary, processed_count: processed, error: terminalError });
  } catch (error) {
    return json({ error: sanitizePayrollStatementDeliveryError(error) }, 422);
  }
});

async function deliverClaimedTarget(admin: any, botToken: string, claim: Record<string, unknown>): Promise<"sent" | "failed" | "unknown" | "rollout_disabled"> {
  const targetId = asString(claim.target_id);
  const dispatchToken = asString(claim.dispatch_token);
  const clubId = asString(claim.club_id);
  const dealerId = asString(claim.dealer_id);
  const storagePath = asString(claim.storage_path);
  const expectedHash = asString(claim.pdf_hash);
  if (!targetId || !dispatchToken || !clubId || !dealerId || !storagePath || !/^[0-9a-f]{64}$/.test(expectedHash)) {
    return "failed";
  }

  // The gate is read again immediately before the external side effect so a
  // master-off incident switch blocks already-created operations as well.
  const { error: gateError } = await admin.rpc("_assert_dealer_payroll_statement_delivery_rollout", {
    p_club_id: clubId,
  });
  if (gateError) {
    await failTarget(admin, targetId, dispatchToken, "TELEGRAM_ROLLOUT_DISABLED", "failed", null);
    return "rollout_disabled";
  }

  const { data: dealer, error: dealerError } = await admin
    .from("dealers")
    .select("telegram_user_id")
    .eq("id", dealerId)
    .eq("club_id", clubId)
    .maybeSingle();
  const chatId = typeof dealer?.telegram_user_id === "number" || typeof dealer?.telegram_user_id === "string"
    ? String(dealer.telegram_user_id)
    : "";
  if (dealerError || !/^\d{1,20}$/.test(chatId)) {
    await failTarget(admin, targetId, dispatchToken, "TELEGRAM_RECIPIENT_UNAVAILABLE", "failed", null);
    return "failed";
  }

  const { data: pdf, error: downloadError } = await admin.storage.from(BUCKET).download(storagePath);
  if (downloadError || !pdf) {
    await failTarget(admin, targetId, dispatchToken, "TELEGRAM_PDF_UNAVAILABLE", "failed", null);
    return "failed";
  }
  const bytes = new Uint8Array(await pdf.arrayBuffer());
  if (await sha256Hex(bytes) !== expectedHash) {
    await failTarget(admin, targetId, dispatchToken, "TELEGRAM_PDF_HASH_CONFLICT", "failed", null);
    return "failed";
  }

  try {
    const form = new FormData();
    form.set("chat_id", chatId);
    form.set("caption", "Phiếu lương của bạn đã sẵn sàng. Vui lòng xem tệp đính kèm.");
    form.set("document", new Blob([bytes], { type: "application/pdf" }), "phieu-luong.pdf");
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
      method: "POST",
      body: form,
    });
    if (!response.ok) {
      await failTarget(
        admin,
        targetId,
        dispatchToken,
        safeTelegramProviderCode(response.status),
        "failed",
        response.status === 429 ? boundedRetryAfterSeconds(response.headers.get("retry-after")) : null,
      );
      return "failed";
    }
  } catch {
    // A transport failure may happen after Telegram accepted the request. It is
    // intentionally terminal/unknown so a retry cannot create a duplicate DM.
    await failTarget(admin, targetId, dispatchToken, safeTelegramProviderCode(null, true), "unknown", null);
    return "unknown";
  }

  const { error: completeError } = await admin.rpc("complete_dealer_payroll_statement_delivery_target", {
    p_target_id: targetId,
    p_dispatch_token: dispatchToken,
    p_pdf_hash: expectedHash,
    p_provider_code: "TELEGRAM_SENT",
  });
  if (completeError) {
    // Telegram may already have accepted this document. Record an explicit
    // terminal unknown state instead of allowing a later automatic re-send.
    await failTarget(admin, targetId, dispatchToken, "TELEGRAM_RECEIPT_UNCONFIRMED", "unknown", null);
    return "unknown";
  }
  return "sent";
}

async function failTarget(
  admin: any,
  targetId: string,
  dispatchToken: string,
  providerCode: string,
  outcome: "failed" | "unknown",
  retryAfterSeconds: number | null,
): Promise<void> {
  await admin.rpc("fail_dealer_payroll_statement_delivery_target", {
    p_target_id: targetId,
    p_dispatch_token: dispatchToken,
    p_provider_code: providerCode,
    p_outcome: outcome,
    p_retry_after_seconds: retryAfterSeconds,
  });
}

async function parseBody(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) return null;
  return await request.json().catch(() => null);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", copyBytesToArrayBuffer(bytes));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
