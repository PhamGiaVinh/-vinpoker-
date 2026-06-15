// Swap-friendly model adapter for the TD AI assistant.
// Today: Lovable AI Gateway → google/gemini-2.5-flash (same gateway/key as
// parse-tournament-schedule). To swap providers (e.g. Claude) later, only this
// file changes — index.ts depends solely on the RawModelAnswer return shape.

export interface ModelRule {
  id: string;
  topicVi: string;
  summaryVi: string;
  citationLabel: string;
}

export interface RawModelAnswer {
  recommendationVi?: string;
  citations?: Array<{ ruleId?: string }>;
  reasoningVi?: string;
  houseRuleOptionVi?: string;
  playerWordingVi?: string;
  confidence?: "low" | "medium" | "high";
  needMoreInfoVi?: string[];
}

export type ModelResult =
  | { ok: true; answer: RawModelAnswer }
  | { ok: false; status: number; error: string };

const SYSTEM = `Bạn là trợ lý đa năng cho Tournament Director (TD) và floor poker ở Việt Nam. Bạn vừa tra cứu luật/xử lý tranh chấp tại bàn, vừa tư vấn vận hành giải đấu, quy trình floor và chiến thuật cơ bản.
QUY TẮC BẮT BUỘC:
- CHỈ tư vấn, KHÔNG ra phán quyết chính thức. Với tranh chấp/luật tại bàn (ruling): luôn dùng giọng "Gợi ý xử lý", "Cần TD xác nhận", KHÔNG dùng "phải xử". Với vận hành/floor: giọng "gợi ý vận hành". Với chiến thuật: giọng "tư vấn tham khảo, mang tính định hướng".
- CHỈ dựa trên và trích dẫn (citations) các ruleId có trong danh sách "Căn cứ được phép" bên dưới. TUYỆT ĐỐI không bịa số quy tắc, không bịa nguồn, không dùng kiến thức ngoài danh sách căn cứ.
- Nếu căn cứ không đủ hoặc không liên quan, trả confidence "low" và nêu "Cần hỏi thêm" thay vì suy đoán.
- Với câu hỏi chiến thuật: nói rõ đây là định hướng chung, KHÔNG phải lời khuyên ràng buộc hay lời khuyên tài chính.
- Toàn bộ trả về bằng tiếng Việt, ngắn gọn, rõ ràng cho nhân viên sàn. playerWordingVi: với tranh chấp là cách nói với khách; với vận hành là cách thông báo cho cả phòng; với chiến thuật là một câu định hướng ngắn.`;

function buildUserContent(situationText: string, rules: ModelRule[]): string {
  const basis = rules
    .map((r) => `- ruleId="${r.id}" | ${r.citationLabel} | ${r.topicVi}: ${r.summaryVi}`)
    .join("\n");
  return `TÌNH HUỐNG:\n${situationText}\n\nCĂN CỨ ĐƯỢC PHÉP (chỉ dùng các ruleId này):\n${basis}`;
}

const TOOL = {
  type: "function",
  function: {
    name: "submit_td_answer",
    description: "Trả về tư vấn cho tình huống TD (luật/vận hành/floor/chiến thuật), chỉ dựa trên căn cứ được phép.",
    parameters: {
      type: "object",
      properties: {
        recommendationVi: { type: "string", description: "Khuyến nghị/gợi ý, giọng tư vấn theo loại tình huống (xử lý / vận hành / định hướng), không phải phán quyết." },
        citations: {
          type: "array",
          items: { type: "object", properties: { ruleId: { type: "string" } }, required: ["ruleId"], additionalProperties: false },
        },
        reasoningVi: { type: "string" },
        houseRuleOptionVi: { type: "string" },
        playerWordingVi: { type: "string", description: "Cách nói với khách, lịch sự." },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
        needMoreInfoVi: { type: "array", items: { type: "string" } },
      },
      required: ["recommendationVi", "citations", "reasoningVi", "playerWordingVi", "confidence"],
      additionalProperties: false,
    },
  },
};

export async function callModel(
  situationText: string,
  rules: ModelRule[],
  fetchImpl: typeof fetch = fetch,
): Promise<ModelResult> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return { ok: false, status: 500, error: "LOVABLE_API_KEY not set" };

  const resp = await fetchImpl("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      temperature: 0,
      max_tokens: 1200,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: buildUserContent(situationText, rules) },
      ],
      tools: [TOOL],
      tool_choice: { type: "function", function: { name: "submit_td_answer" } },
    }),
  });

  if (!resp.ok) {
    const status = resp.status === 429 || resp.status === 402 ? resp.status : 502;
    return { ok: false, status, error: `AI gateway ${resp.status}` };
  }

  const data = await resp.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) return { ok: false, status: 502, error: "No tool call in model response" };
  try {
    return { ok: true, answer: JSON.parse(toolCall.function.arguments) as RawModelAnswer };
  } catch {
    return { ok: false, status: 502, error: "Bad tool-call JSON" };
  }
}
