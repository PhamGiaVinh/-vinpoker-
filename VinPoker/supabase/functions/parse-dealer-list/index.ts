// Parse a dealer NAME list from an uploaded file via Google Gemini (native generateContent).
// Used by the bulk-dealer-import dialog: operator uploads an image/PDF/Word/other (sent as
// inlineData base64) OR a spreadsheet already dumped to plain text (sent as content_text), and
// this returns ONLY the human names — everything else (phone/ID/dates/salary/headers) is dropped.
//
// SECURITY (P0-1): requires an authenticated caller who is dealer-control/admin of the target
// club, checked BEFORE any Gemini call (the GEMINI_API_KEY costs money + this touches staff data,
// so it must never be callable anonymously). Mirrors the auth-gate of send-shift-schedule.
//
// PRIVACY (P0-4): never logs file content, dumped text, extracted names, or the Gemini response
// body — only counts + status codes.
//
// Contract:
//   request : { club_id: uuid, content_base64?: string, content_mime?: string, content_text?: string }
//             (exactly one of content_base64 | content_text)
//   success : 200 { names: string[], warnings?: string[] }
//   handled : 200 { error: "<clear Vietnamese message>" }  (surfaced by the caller's `if(data?.error) throw`)
//   auth    : 401 unauthorized · 403 forbidden  (before Gemini)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parseBody, z } from "../_shared/validate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// P0-2 server-side hard caps (defense in depth; the client also enforces friendlier limits).
// base64 of a 10MB binary is ~13.4MB; text dump capped ~200k chars.
const BodySchema = z
  .object({
    club_id: z.string().uuid(),
    content_base64: z.string().min(20).max(14 * 1024 * 1024).optional(),
    content_mime: z.string().max(150).optional(),
    content_text: z.string().min(1).max(200_000).optional(),
  })
  .refine((d) => !!d.content_base64 || !!d.content_text, {
    message: "content_base64 or content_text required",
  });

const SYSTEM = `Bạn là trợ lý trích xuất DANH SÁCH TÊN NHÂN VIÊN (dealer) từ tài liệu tiếng Việt.
Nhiệm vụ: đọc nội dung (ảnh/PDF/văn bản/bảng tính) và trả về CHỈ HỌ TÊN NGƯỜI.
QUY TẮC:
- CHỈ lấy tên người. BỎ QUA hoàn toàn: số thứ tự, số điện thoại, CCCD/CMND, ngày sinh, ngày tháng, địa chỉ, email, chức vụ, ghi chú, lương, tiêu đề cột, dòng trống, tổng cộng.
- Giữ nguyên dấu tiếng Việt và cách viết hoa hợp lý của tên.
- KHÔNG bịa thêm tên không có trong tài liệu.
- Loại bỏ trùng lặp giống hệt nhau.
- Nếu một dòng không chắc là tên người thật, BỎ QUA nó và ghi 1 dòng ngắn vào "warnings".
- Nếu tài liệu không chứa danh sách tên người, trả về "names" rỗng.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    names: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["names"],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";

    const parsed = await parseBody(req, BodySchema, corsHeaders);
    if (!parsed.ok) return parsed.response;
    const { club_id, content_base64, content_mime, content_text } = parsed.data;

    // ── Auth gate (P0-1): must be a logged-in dealer-control/admin of this club ──
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) return json(401, { error: "unauthorized" });

    const [{ data: isCtrl }, { data: isAdmin }] = await Promise.all([
      admin.rpc("is_club_dealer_control", { _user_id: user.id, _club_id: club_id }),
      admin.rpc("is_club_admin", { _user_id: user.id, _club_id: club_id }),
    ]);
    if (!isCtrl && !isAdmin) return json(403, { error: "forbidden" });

    // ── Gemini ──
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      return json(200, {
        error:
          "Chưa cấu hình AI đọc file (thiếu GEMINI_API_KEY). Vào Supabase → Edge Functions → Secrets, thêm secret tên GEMINI_API_KEY (lấy khoá miễn phí tại aistudio.google.com).",
      });
    }
    const MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";

    const userParts: unknown[] = content_base64
      ? [
          { text: "Trích xuất danh sách tên người từ tài liệu này." },
          { inlineData: { mimeType: content_mime || "application/octet-stream", data: content_base64 } },
        ]
      : [{ text: `Trích xuất danh sách tên người từ nội dung bảng sau:\n\n${content_text}` }];

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": GEMINI_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: "user", parts: userParts }],
          generationConfig: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
        }),
      },
    );

    if (!resp.ok) {
      // P0-4: log only the status, never the response body (may echo input).
      console.error("[parse-dealer-list] Gemini error status", resp.status);
      if (resp.status === 429) return json(200, { error: "Hết hạn mức hoặc quá nhiều yêu cầu Gemini — thử lại sau ít phút (429)." });
      if (resp.status === 400) return json(200, { error: "File không đọc được (400). Nếu là Word, hãy xuất PDF hoặc chụp ảnh danh sách." });
      if (resp.status === 401 || resp.status === 403) return json(200, { error: "Khoá GEMINI_API_KEY không hợp lệ (" + resp.status + ") — kiểm tra lại secret." });
      return json(200, { error: "Máy chủ AI Gemini đang lỗi (" + resp.status + ") — thử lại sau." });
    }

    const data = await resp.json();
    const cand = data?.candidates?.[0];
    if (cand?.finishReason && cand.finishReason !== "STOP" && cand.finishReason !== "MAX_TOKENS") {
      console.error("[parse-dealer-list] Gemini non-STOP finishReason", cand.finishReason);
      return json(200, { error: "AI không đọc được file này (" + cand.finishReason + ") — thử file khác hoặc chụp ảnh." });
    }
    const text = (cand?.content?.parts ?? []).map((p: { text?: string }) => p?.text).filter(Boolean).join("");
    let out: { names?: unknown; warnings?: unknown } = {};
    try { out = JSON.parse(text); } catch { /* structured output missing → empty */ }

    const names = Array.isArray(out?.names)
      ? (out.names as unknown[]).map((n) => String(n).trim()).filter((n) => n.length > 0)
      : [];
    const warnings = Array.isArray(out?.warnings)
      ? (out.warnings as unknown[]).map((w) => String(w)).filter(Boolean)
      : [];

    // P0-4: log count only, never the names.
    console.log("[parse-dealer-list] extracted", names.length, "names");
    return json(200, { names, warnings });
  } catch (e) {
    console.error("[parse-dealer-list] error", e instanceof Error ? e.message : "unknown");
    return json(500, { error: e instanceof Error ? e.message : "Unknown" });
  }
});
