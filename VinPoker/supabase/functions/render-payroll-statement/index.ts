import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.2";
import { renderPayrollStatementPdf, loadPayrollPdfFonts } from "../_shared/payrollPdf/render.ts";
import type { PayrollPdfMode, PayrollStatementSnapshot } from "../_shared/payrollPdf/types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MAX_BODY_BYTES = 16_384;
const SIGNED_URL_TTL_SECONDS = 300;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "UNAUTHORIZED" }, 401);
    const body = await parseBody(request);
    if (!body || !isUuid(body.statement_id) || !["preview", "final"].includes(String(body.mode))) {
      return json({ error: "INVALID_REQUEST" }, 400);
    }
    const mode = body.mode as PayrollPdfMode;
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "PDF_RENDERER_DEPENDENCY_UNAVAILABLE" }, 503);

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userError } = await userClient.auth.getUser(authHeader.slice(7));
    if (userError || !userData.user?.id) return json({ error: "UNAUTHORIZED" }, 401);

    const { data: statement, error: statementError } = await userClient.rpc("get_dealer_payroll_statement", {
      p_statement_id: body.statement_id,
    });
    if (statementError || !statement) return json({ error: "PAYROLL_STATEMENT_UNAVAILABLE" }, 404);
    const snapshot = statement as PayrollStatementSnapshot;
    const fonts = await loadPayrollPdfFonts();
    const rendered = await renderPayrollStatementPdf(snapshot, { mode, fonts });

    if (mode === "preview") {
      return new Response(copyBytesToArrayBuffer(rendered.bytes), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="payslip-preview-${snapshot.id}.pdf"`,
          "Cache-Control": "no-store",
          "X-Payroll-Statement-Hash": snapshot.statement_hash,
        },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    if (!(await isFinalPdfActor(admin, userData.user.id, snapshot.club_id))) return json({ error: "FORBIDDEN" }, 403);
    if (!["finalized", "pdf_rendered", "delivery_failed", "sent"].includes(snapshot.state)) {
      return json({ error: "PAYROLL_STATEMENT_NOT_FINALIZED" }, 409);
    }

    const pdfHash = await sha256Hex(rendered.bytes);
    const storagePath = `statements/${snapshot.club_id}/${snapshot.id}/${rendered.renderVersion}.pdf`;
    const { data: existing } = await admin
      .from("dealer_payroll_statements")
      .select("state, pdf_hash, pdf_storage_path, pdf_render_version")
      .eq("id", snapshot.id)
      .maybeSingle();
    const reused = existing?.pdf_hash === pdfHash && existing?.pdf_storage_path === storagePath;

    if (!reused) {
      const { error: uploadError } = await admin.storage.from("payroll-statements").upload(storagePath, rendered.bytes, {
        contentType: "application/pdf",
        cacheControl: "31536000",
        upsert: true,
      });
      if (uploadError) return json({ error: "PDF_STORAGE_UPLOAD_FAILED" }, 502);
      const { error: markError } = await admin.rpc("mark_dealer_payroll_statement_pdf_rendered", {
        p_statement_id: snapshot.id,
        p_pdf_hash: pdfHash,
        p_storage_path: storagePath,
        p_render_version: rendered.renderVersion,
      });
      if (markError) return json({ error: "PDF_STATEMENT_MARK_FAILED" }, 502);
    }

    const { data: signed, error: signedError } = await admin.storage
      .from("payroll-statements")
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
    if (signedError || !signed?.signedUrl) return json({ error: "PDF_SIGNED_URL_FAILED" }, 502);
    return json({
      statement_id: snapshot.id,
      state: "pdf_rendered",
      pdf_hash: pdfHash,
      render_version: rendered.renderVersion,
      download_url: signed.signedUrl,
      expires_in_seconds: SIGNED_URL_TTL_SECONDS,
      reused,
    });
  } catch (error) {
    const code = error instanceof Error && /^PAYROLL_PDF_[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "PDF_RENDER_FAILED";
    return json({ error: code }, 422);
  }
});

async function parseBody(request: Request): Promise<Record<string, unknown> | null> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) return null;
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
}

async function isFinalPdfActor(admin: { from: (relation: string) => any }, userId: string, clubId: string): Promise<boolean> {
  const [{ data: superAdmin }, { data: owner }, { data: cashier }] = await Promise.all([
    admin.from("user_roles").select("user_id").eq("user_id", userId).eq("role", "super_admin").maybeSingle(),
    admin.from("clubs").select("id").eq("id", clubId).eq("owner_id", userId).maybeSingle(),
    admin.from("club_cashiers").select("club_id").eq("club_id", clubId).eq("user_id", userId).maybeSingle(),
  ]);
  return Boolean(superAdmin || owner || cashier);
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

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
