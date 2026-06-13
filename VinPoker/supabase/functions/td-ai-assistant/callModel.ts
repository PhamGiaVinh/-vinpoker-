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

const SYSTEM = `Bạn là trợ lý tra cứu luật cho Tournament Director (TD) poker Việt Nam.
QUY TẮC BẮT BUỘC:
- CHỈ tư vấn, KHÔNG ra phán quyết chính thức. Luôn dùng giọng "Gợi ý xử lý", "Cần TD xác nhận". KHÔNG dùng "phải xử".
- CHỈ trích dẫn (citations) bằng ruleId có trong danh sách "Căn cứ được phép" bên dưới. TUYỆT ĐỐI không bịa số quy tắc hay nguồn nào khác.
- Nếu căn cứ không đủ, trả confidence "low" và nêu "Cần hỏi thêm" thay vì suy đoán.
- Toàn bộ nội dung trả về bằng tiếng Việt, ngắn gọn, rõ ràng cho nhân viên sàn.`;

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
    description: "Trả về tư vấn xử lý tình huống TD, chỉ dựa trên căn cứ được phép.",
    parameters: {
      type: "object",
      properties: {
        recommendationVi: { type: "string", description: "Gợi ý xử lý, giọng tư vấn, không phải phán quyết." },
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
