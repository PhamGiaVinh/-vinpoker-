// Provider-agnostic model adapter for the TD AI assistant. NO Lovable.
//
// Provider + model are configured by Edge secrets, so swapping providers needs
// no code change:
//   TD_AI_PROVIDER = "gemini" (default) | "groq" | "openrouter"
//   TD_AI_MODEL    = optional model override (per-provider default below)
//   GEMINI_API_KEY        — Google AI Studio (Generative Language API) free tier
//   GROQ_API_KEY          — optional, OpenAI-compatible
//   OPENROUTER_API_KEY    — optional, OpenAI-compatible
//
// index.ts depends only on the RawModelAnswer shape; logic.ts's deterministic
// no-hallucination validator sanitises whatever the model returns (drops
// uncited rules, flags fabricated rule numbers). On ANY failure — missing key,
// quota/429, network, bad JSON — callModel returns ok:false and the caller
// falls back to the offline corpus, so the UI never breaks.

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

type Provider = "gemini" | "groq" | "openrouter";

const DEFAULT_MODEL: Record<Provider, string> = {
  gemini: "gemini-2.5-flash",
  groq: "llama-3.3-70b-versatile",
  openrouter: "google/gemini-2.0-flash-exp:free",
};

// ── Gemini native (Generative Language API, structured JSON output) ──────────
// Uppercase Type enum per the Generative Language Schema spec; no
// additionalProperties (unsupported by Gemini responseSchema).
const GEMINI_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    recommendationVi: { type: "STRING" },
    citations: {
      type: "ARRAY",
      items: { type: "OBJECT", properties: { ruleId: { type: "STRING" } }, required: ["ruleId"] },
    },
    reasoningVi: { type: "STRING" },
    houseRuleOptionVi: { type: "STRING" },
    playerWordingVi: { type: "STRING" },
    confidence: { type: "STRING", enum: ["low", "medium", "high"] },
    needMoreInfoVi: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["recommendationVi", "citations", "reasoningVi", "playerWordingVi", "confidence"],
};

async function callGemini(
  model: string,
  key: string,
  situationText: string,
  rules: ModelRule[],
  fetchImpl: typeof fetch,
): Promise<ModelResult> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const resp = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: buildUserContent(situationText, rules) }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 1200,
        responseMimeType: "application/json",
        responseSchema: GEMINI_RESPONSE_SCHEMA,
      },
    }),
  });

  if (!resp.ok) {
    const status = resp.status === 429 ? 429 : 502;
    return { ok: false, status, error: `Gemini ${resp.status}` };
  }

  const data = await resp.json();
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return { ok: false, status: 502, error: "Empty Gemini response" };
  try {
    return { ok: true, answer: JSON.parse(text) as RawModelAnswer };
  } catch {
    return { ok: false, status: 502, error: "Bad Gemini JSON" };
  }
}

// ── OpenAI-compatible (Groq / OpenRouter), forced tool call ──────────────────
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

async function callOpenAICompatible(
  endpoint: string,
  model: string,
  key: string,
  extraHeaders: Record<string, string>,
  situationText: string,
  rules: ModelRule[],
  fetchImpl: typeof fetch,
): Promise<ModelResult> {
  const resp = await fetchImpl(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify({
      model,
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

export async function callModel(
  situationText: string,
  rules: ModelRule[],
  fetchImpl: typeof fetch = fetch,
): Promise<ModelResult> {
  const provider = (Deno.env.get("TD_AI_PROVIDER") || "gemini").trim().toLowerCase() as Provider;
  const model = Deno.env.get("TD_AI_MODEL")?.trim() || DEFAULT_MODEL[provider];

  switch (provider) {
    case "gemini": {
      const key = Deno.env.get("GEMINI_API_KEY");
      if (!key) return { ok: false, status: 500, error: "GEMINI_API_KEY not set" };
      return callGemini(model, key, situationText, rules, fetchImpl);
    }
    case "groq": {
      const key = Deno.env.get("GROQ_API_KEY");
      if (!key) return { ok: false, status: 500, error: "GROQ_API_KEY not set" };
      return callOpenAICompatible(
        "https://api.groq.com/openai/v1/chat/completions",
        model, key, {}, situationText, rules, fetchImpl,
      );
    }
    case "openrouter": {
      const key = Deno.env.get("OPENROUTER_API_KEY");
      if (!key) return { ok: false, status: 500, error: "OPENROUTER_API_KEY not set" };
      return callOpenAICompatible(
        "https://openrouter.ai/api/v1/chat/completions",
        model, key,
        { "HTTP-Referer": "https://vinpoker.vercel.app", "X-Title": "VinPoker TD AI" },
        situationText, rules, fetchImpl,
      );
    }
    default:
      return { ok: false, status: 500, error: `Unknown TD_AI_PROVIDER: ${provider}` };
  }
}
