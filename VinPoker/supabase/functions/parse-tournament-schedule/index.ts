// Parse tournament schedule images via Google Gemini (native generateContent, vision + structured
// output). Self-owned: calls Google's Generative Language API DIRECTLY with the club's own
// GEMINI_API_KEY secret — no third-party AI gateway (Lovable) in the middle.
//
// Contract (unchanged, so the two callers — floor/BulkScheduleDialog.tsx and
// pages/BulkCreateTournaments.tsx — keep working without any frontend change):
//   request : { image_base64: string, image_mime?: "image/png"|"image/jpeg"|"image/jpg"|"image/webp" }
//   success : 200 { tournaments: [{ name, start_time, buy_in, starting_stack, game_type, venue }] }
//   handled : 200 { error: "<clear Vietnamese message>" }  ← so the UI surfaces the REAL reason.
//             (A non-2xx status is swallowed by supabase-js as the generic "Edge Function returned
//              a non-2xx status code"; returning 200 + {error} makes the actual cause visible via
//              the callers' existing `if (data?.error) throw` path — no frontend change required.)
//   crash   : 500 { error: "..." }  (unexpected only; details also in the function logs)
import { parseBody, z } from "../_shared/validate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// ~8MB base64 image cap (≈6MB binary)
const BodySchema = z.object({
  image_base64: z.string().min(100).max(8 * 1024 * 1024),
  image_mime: z.enum(["image/png", "image/jpeg", "image/jpg", "image/webp"]).optional(),
});

const SYSTEM = `Bạn là trợ lý OCR cho lịch thi đấu poker tournament Việt Nam.
Đọc ảnh lịch và trích xuất TẤT CẢ các giải đấu thấy được.
Ngày giờ: trả về ISO 8601 với timezone +07:00 (giờ Việt Nam). Năm hiện tại nếu ảnh không ghi rõ.
buy_in: số VND (ví dụ "1.5M" => 1500000, "500K" => 500000, "2tr" => 2000000). Nếu không thấy: 0.
game_type: chỉ "nlh" | "plo" | "mixed". Mặc định "nlh".
starting_stack: số chip nếu có, mặc định 20000.
name: tên giải đầy đủ và rõ ràng.
venue: địa điểm/club nếu thấy, có thể null.
Nếu không chắc, vẫn trả về với thông tin tốt nhất - không bịa số liệu. Nếu ảnh không phải lịch giải, trả về mảng rỗng.`;

// Gemini responseSchema (OpenAPI subset) — forces structured JSON so we never parse free text.
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    tournaments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          start_time: { type: "string", description: "ISO 8601 với +07:00" },
          buy_in: { type: "integer", description: "VND" },
          starting_stack: { type: "integer" },
          game_type: { type: "string", enum: ["nlh", "plo", "mixed"] },
          venue: { type: "string", nullable: true },
        },
        required: ["name", "start_time", "buy_in", "starting_stack", "game_type"],
      },
    },
  },
  required: ["tournaments"],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const parsed = await parseBody(req, BodySchema, corsHeaders);
    if (!parsed.ok) return parsed.response;
    const { image_base64, image_mime } = parsed.data;

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      return json(200, {
        error: "Chưa cấu hình AI đọc ảnh (thiếu GEMINI_API_KEY). Vào Supabase → Edge Functions → Secrets, thêm secret tên GEMINI_API_KEY (lấy khoá miễn phí tại Google AI Studio: aistudio.google.com).",
      });
    }
    const MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": GEMINI_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{
            role: "user",
            parts: [
              { text: "Trích xuất tất cả tournament từ ảnh này." },
              { inlineData: { mimeType: image_mime || "image/jpeg", data: image_base64 } },
            ],
          }],
          generationConfig: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
        }),
      },
    );

    if (!resp.ok) {
      const detail = await resp.text();
      console.error("Gemini error", resp.status, detail.slice(0, 500));
      // Map to clear, owner-actionable Vietnamese messages (returned as 200 so the UI shows them).
      if (resp.status === 429) return json(200, { error: "Hết hạn mức hoặc quá nhiều yêu cầu Gemini — thử lại sau ít phút (429)." });
      if (resp.status === 400) return json(200, { error: "Ảnh không hợp lệ hoặc yêu cầu sai (400) — thử ảnh rõ hơn / định dạng PNG-JPG." });
      if (resp.status === 401 || resp.status === 403) return json(200, { error: "Khoá GEMINI_API_KEY không hợp lệ hoặc chưa bật quyền (" + resp.status + ") — kiểm tra lại secret." });
      return json(200, { error: "Máy chủ AI Gemini đang lỗi (" + resp.status + ") — thử lại sau." });
    }

    const data = await resp.json();
    const cand = data?.candidates?.[0];
    if (cand?.finishReason && cand.finishReason !== "STOP" && cand.finishReason !== "MAX_TOKENS") {
      console.error("Gemini non-STOP finishReason", cand.finishReason);
      return json(200, { error: "AI không đọc được ảnh này (" + cand.finishReason + ") — thử ảnh khác." });
    }
    const text = (cand?.content?.parts ?? []).map((p: { text?: string }) => p?.text).filter(Boolean).join("");
    let out: { tournaments?: unknown[] } = { tournaments: [] };
    try { out = JSON.parse(text); } catch { /* structured output missing → empty list */ }

    return json(200, { tournaments: Array.isArray(out?.tournaments) ? out.tournaments : [] });
  } catch (e) {
    console.error("parse-tournament-schedule error", e);
    return json(500, { error: e instanceof Error ? e.message : "Unknown" });
  }
});
