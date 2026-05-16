// Parse tournament schedule images via Lovable AI (Gemini vision)
import { parseBody, z } from "../_shared/validate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
Nếu không chắc, vẫn trả về với confidence thấp - không bịa số liệu.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const parsed = await parseBody(req, BodySchema, corsHeaders);
    if (!parsed.ok) return parsed.response;
    const { image_base64, image_mime } = parsed.data;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not set");

    const dataUrl = `data:${image_mime || "image/jpeg"};base64,${image_base64}`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: "Trích xuất tất cả tournament từ ảnh này." },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        tools: [{
          type: "function",
          function: {
            name: "submit_tournaments",
            description: "Trả về danh sách tournament đã trích xuất.",
            parameters: {
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
                      venue: { type: ["string", "null"] },
                    },
                    required: ["name", "start_time", "buy_in", "starting_stack", "game_type"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["tournaments"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "submit_tournaments" } },
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("AI gateway error", resp.status, t);
      if (resp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit. Thử lại sau ít phút." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (resp.status === 402) {
        return new Response(JSON.stringify({ error: "Hết credits Lovable AI. Nạp tại Settings → Workspace → Usage." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    const args = toolCall ? JSON.parse(toolCall.function.arguments) : { tournaments: [] };

    return new Response(JSON.stringify(args), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-tournament-schedule error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
