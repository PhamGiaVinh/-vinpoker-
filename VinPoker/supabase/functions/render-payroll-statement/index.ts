import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.2";
import {
  buildPayrollStatementViewModel,
  renderPayrollStatementPdf,
  loadPayrollPdfFonts,
} from "../_shared/payrollPdf/render.ts";
import type { PayrollStatementSnapshot } from "../_shared/payrollPdf/types.ts";
import {
  fixedPayrollPdfPath,
  parsePayrollPdfRequest,
  payrollPdfDownloadFilename,
  sanitizePayrollPdfError,
} from "./runtime.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MAX_BODY_BYTES = 16_384;
const SIGNED_URL_TTL_SECONDS = 300;
const BUCKET = "payroll-statements";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  let claimed: { statementId: string; token: string } | null = null;
  let admin: any = null;
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "UNAUTHORIZED" }, 401);
    const parsed = parsePayrollPdfRequest(await parseBody(request));
    if (!parsed) return json({ error: "INVALID_REQUEST" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "PAYROLL_PDF_DEPENDENCY_UNAVAILABLE" }, 503);

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    admin = createClient(supabaseUrl, serviceKey);
    const { data: userData, error: userError } = await userClient.auth.getUser(authHeader.slice(7));
    if (userError || !userData.user?.id) return json({ error: "UNAUTHORIZED" }, 401);

    if (
      parsed.mode === "preview_ft" || parsed.mode === "preview_ft_view"
      || parsed.mode === "preview_pt" || parsed.mode === "preview_pt_view"
    ) {
      const rollout = await requireRollout(userClient, parsed.club_id);
      if (!rollout.allowed) return json({ error: rollout.error }, rollout.status);
      const isPartTime = parsed.mode === "preview_pt" || parsed.mode === "preview_pt_view";
      const { data, error } = await userClient.rpc(
        isPartTime ? "preview_part_time_payroll_statement" : "preview_full_time_payroll_statement",
        {
          p_club_id: parsed.club_id,
          p_dealer_id: parsed.dealer_id,
          p_payroll_period_id: parsed.payroll_period_id,
        },
      );
      if (error || !data) return json({ error: sanitizePayrollPdfError(error, "PAYROLL_STATEMENT_PREVIEW_UNAVAILABLE") }, 409);
      const snapshot = data as PayrollStatementSnapshot;
      if (parsed.mode === "preview_ft_view" || parsed.mode === "preview_pt_view") {
        return json({ view: buildPayrollStatementViewModel(snapshot, true) });
      }
      const rendered = await renderPayrollStatementPdf(snapshot, {
        mode: "draft_preview",
        fonts: await loadPayrollPdfFonts(),
      });
      return pdf(rendered.bytes, payrollPdfDownloadFilename(snapshot.id, snapshot.source_snapshot, true), snapshot.statement_hash);
    }

    if (!("statement_id" in parsed)) return json({ error: "INVALID_REQUEST" }, 400);
    const { data: statement, error: statementError } = await userClient.rpc("get_dealer_payroll_statement", {
      p_statement_id: parsed.statement_id,
    });
    if (statementError || !statement) return json({ error: "PAYROLL_STATEMENT_UNAVAILABLE" }, 404);
    const snapshot = statement as PayrollStatementSnapshot;
    const rollout = await requireRollout(userClient, snapshot.club_id);
    if (!rollout.allowed) return json({ error: rollout.error }, rollout.status);
    if (!(await isPdfActor(admin, userData.user.id, snapshot.club_id))) return json({ error: "FORBIDDEN" }, 403);

    if (parsed.mode === "preview_view") {
      return json({ view: buildPayrollStatementViewModel(snapshot, false) });
    }

    if (parsed.mode === "preview") {
      const rendered = await renderPayrollStatementPdf(snapshot, {
        mode: "finalized",
        fonts: await loadPayrollPdfFonts(),
      });
      return pdf(rendered.bytes, payrollPdfDownloadFilename(snapshot.id, snapshot.source_snapshot), snapshot.statement_hash);
    }

    const requestId = crypto.randomUUID();
    const { data: claimData, error: claimError } = await admin.rpc("claim_dealer_payroll_statement_pdf", {
      p_statement_id: snapshot.id,
      p_request_id: requestId,
    });
    if (claimError || !claimData) return json({ error: sanitizePayrollPdfError(claimError, "PAYROLL_PDF_CLAIM_FAILED") }, 409);
    const claim = claimData as Record<string, unknown>;
    if (claim.outcome === "generating") {
      return json({ error: "PAYROLL_PDF_GENERATION_IN_PROGRESS" }, 409, { "Retry-After": "2" });
    }

    if (claim.outcome === "ready") {
      const path = String(claim.storage_path ?? "");
      await verifyStoredObject(admin, path, snapshot.statement_hash, String(claim.render_version), String(claim.pdf_hash));
      return await signedDownload(
        admin,
        snapshot.id,
        path,
        String(claim.pdf_hash),
        String(claim.render_version),
        payrollPdfDownloadFilename(snapshot.id, snapshot.source_snapshot),
        true,
      );
    }
    if (claim.outcome !== "claimed" || typeof claim.generation_token !== "string") {
      return json({ error: "PAYROLL_PDF_CLAIM_FAILED" }, 409);
    }

    const storagePath = fixedPayrollPdfPath(snapshot.club_id, snapshot.id);
    if (claim.storage_path !== storagePath) return json({ error: "PAYROLL_PDF_OBJECT_CONFLICT" }, 409);
    claimed = { statementId: snapshot.id, token: claim.generation_token };

    const recovered = await recoverUploadedObject(admin, storagePath, snapshot.statement_hash);
    let pdfHash: string;
    let renderVersion: string;
    if (recovered) {
      pdfHash = recovered.pdfHash;
      renderVersion = recovered.renderVersion;
    } else {
      const rendered = await renderPayrollStatementPdf(snapshot, {
        mode: "finalized",
        fonts: await loadPayrollPdfFonts(),
      });
      pdfHash = await sha256Hex(rendered.bytes);
      renderVersion = rendered.renderVersion;
      const { error: uploadError } = await admin.storage.from(BUCKET).upload(storagePath, rendered.bytes, {
        contentType: "application/pdf",
        cacheControl: "31536000",
        upsert: false,
        metadata: {
          statement_hash: snapshot.statement_hash,
          render_version: renderVersion,
        },
      });
      if (uploadError) {
        const afterRace = await recoverUploadedObject(admin, storagePath, snapshot.statement_hash);
        if (!afterRace) throw new Error("PAYROLL_PDF_STORAGE_UPLOAD_FAILED");
        pdfHash = afterRace.pdfHash;
        renderVersion = afterRace.renderVersion;
      }
    }

    const { error: completeError } = await admin.rpc("complete_dealer_payroll_statement_pdf", {
      p_statement_id: snapshot.id,
      p_generation_token: claimed.token,
      p_pdf_hash: pdfHash,
      p_render_version: renderVersion,
    });
    if (completeError) throw new Error(sanitizePayrollPdfError(completeError, "PAYROLL_PDF_COMPLETE_FAILED"));
    claimed = null;
    return await signedDownload(
      admin,
      snapshot.id,
      storagePath,
      pdfHash,
      renderVersion,
      payrollPdfDownloadFilename(snapshot.id, snapshot.source_snapshot),
      recovered !== null,
    );
  } catch (error) {
    const code = sanitizePayrollPdfError(error);
    if (claimed && admin) {
      try {
        await admin.rpc("fail_dealer_payroll_statement_pdf", {
          p_statement_id: claimed.statementId,
          p_generation_token: claimed.token,
          p_error_code: code,
        });
      } catch {
        // The original sanitized failure remains authoritative.
      }
    }
    return json({ error: code }, code === "PAYROLL_STATEMENT_ROLLOUT_DISABLED" ? 503 : 422);
  }
});

async function requireRollout(client: any, clubId: string): Promise<{ allowed: boolean; error: string; status: number }> {
  const { data, error } = await client.rpc("get_dealer_payroll_statement_rollout", {
    p_expected_club_id: clubId,
  });
  if (error || !data || data.allowed !== true) {
    return {
      allowed: false,
      error: error ? "PAYROLL_STATEMENT_ROLLOUT_UNAVAILABLE" : "PAYROLL_STATEMENT_ROLLOUT_DISABLED",
      status: error ? 503 : 403,
    };
  }
  return { allowed: true, error: "", status: 200 };
}

async function isPdfActor(admin: any, userId: string, clubId: string): Promise<boolean> {
  const [{ data: superAdmin }, { data: owner }, { data: cashier }] = await Promise.all([
    admin.from("user_roles").select("user_id").eq("user_id", userId).eq("role", "super_admin").maybeSingle(),
    admin.from("clubs").select("id").eq("id", clubId).eq("owner_id", userId).maybeSingle(),
    admin.from("club_cashiers").select("club_id").eq("club_id", clubId).eq("user_id", userId).maybeSingle(),
  ]);
  return Boolean(superAdmin || owner || cashier);
}

async function recoverUploadedObject(admin: any, path: string, statementHash: string): Promise<{ pdfHash: string; renderVersion: string } | null> {
  const descriptor = await objectDescriptor(admin, path);
  if (!descriptor) return null;
  if (descriptor.statementHash !== statementHash || !descriptor.renderVersion) {
    throw new Error("PAYROLL_PDF_OBJECT_CONFLICT");
  }
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error("PAYROLL_PDF_OBJECT_CONFLICT");
  return { pdfHash: await sha256Hex(new Uint8Array(await data.arrayBuffer())), renderVersion: descriptor.renderVersion };
}

async function verifyStoredObject(admin: any, path: string, statementHash: string, renderVersion: string, pdfHash: string): Promise<void> {
  const recovered = await recoverUploadedObject(admin, path, statementHash);
  if (!recovered || recovered.renderVersion !== renderVersion || recovered.pdfHash !== pdfHash) {
    throw new Error("PAYROLL_PDF_OBJECT_CONFLICT");
  }
}

async function objectDescriptor(admin: any, path: string): Promise<{ statementHash: string | null; renderVersion: string | null } | null> {
  const { data, error } = await admin.schema("storage").from("objects")
    .select("name,user_metadata").eq("bucket_id", BUCKET).eq("name", path).maybeSingle();
  if (error) throw new Error("PAYROLL_PDF_OBJECT_LOOKUP_FAILED");
  if (!data) return null;
  const metadata = data.user_metadata && typeof data.user_metadata === "object" ? data.user_metadata : {};
  return {
    statementHash: typeof metadata.statement_hash === "string" ? metadata.statement_hash : null,
    renderVersion: typeof metadata.render_version === "string" ? metadata.render_version : null,
  };
}

async function signedDownload(
  admin: any,
  statementId: string,
  path: string,
  pdfHash: string,
  renderVersion: string,
  downloadFilename: string,
  reused: boolean,
): Promise<Response> {
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) throw new Error("PAYROLL_PDF_SIGNED_URL_FAILED");
  return json({
    statement_id: statementId,
    state: "pdf_rendered",
    pdf_status: "ready",
    pdf_hash: pdfHash,
    render_version: renderVersion,
    download_url: data.signedUrl,
    download_filename: downloadFilename,
    expires_in_seconds: SIGNED_URL_TTL_SECONDS,
    reused,
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

function pdf(bytes: Uint8Array, filename: string, statementHash: string): Response {
  return new Response(copyBytesToArrayBuffer(bytes), {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Payroll-Statement-Hash": statementHash,
    },
  });
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function json(value: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...corsHeaders, ...extraHeaders, "Content-Type": "application/json" },
  });
}
