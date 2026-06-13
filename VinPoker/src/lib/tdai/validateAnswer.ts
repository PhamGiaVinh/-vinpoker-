import type { TdAnswer, TdCitation, TdConfidence, TdRule } from "./types";
import { normalize } from "./localSearch";

// Deterministic no-hallucination guard, run in the edge function AFTER the
// model returns. The model is instructed to cite only retrieved rules, but we
// never trust that — this code is the actual guarantee:
//   1. drop any citation whose ruleId is not in the retrieved set
//   2. scan the prose for rule numbers (#NN) not backed by a retrieved rule →
//      flag fabrication and force confidence to "low"
//   3. if zero valid citations remain → return the "not enough basis" template
//      instead of surfacing an unbacked synthesized ruling.

export const TD_NO_BASIS_RECOMMENDATION_VI =
  "Không đủ căn cứ rõ ràng để đưa khuyến nghị. Cần TD xác nhận trực tiếp tại bàn.";

/** Raw fields parsed from the model's forced tool-call. */
export interface RawModelAnswer {
  recommendationVi?: string;
  citations?: Array<{ ruleId?: string }>;
  reasoningVi?: string;
  houseRuleOptionVi?: string;
  playerWordingVi?: string;
  confidence?: TdConfidence;
  needMoreInfoVi?: string[];
}

const RULE_NUM_RE = /(rule|quy tac|dieu|tda)\s*#?\s*(\d+)/g;

function numbersIn(text: string): Set<string> {
  const out = new Set<string>();
  const norm = normalize(text);
  let m: RegExpExecArray | null;
  RULE_NUM_RE.lastIndex = 0;
  while ((m = RULE_NUM_RE.exec(norm)) !== null) out.add(m[2]);
  return out;
}

function allowedNumbers(rules: TdRule[]): Set<string> {
  const out = new Set<string>();
  for (const r of rules) {
    const m = r.citationLabel.match(/#?\s*(\d+)/);
    if (m) out.add(m[1]);
  }
  return out;
}

function noBasisAnswer(needMore: string[]): TdAnswer {
  return {
    source: "ai",
    isDemo: false,
    recommendationVi: TD_NO_BASIS_RECOMMENDATION_VI,
    citations: [],
    reasoningVi:
      "Không tìm thấy quy tắc phù hợp trong bộ luật đã tra. Trợ lý chỉ tư vấn dựa trên căn cứ truy hồi được — không suy đoán.",
    houseRuleOptionVi:
      "Ưu tiên luật CLB đã công bố và để TD/chủ CLB quyết định cuối cùng.",
    playerWordingVi:
      "Anh/chị cho em xin thêm chi tiết để em kiểm tra và mời TD xác nhận giúp mình nhé.",
    confidence: "low",
    needMoreInfoVi: needMore.length ? needMore : ["Mô tả rõ hơn tình huống tranh chấp."],
    matchedRuleIds: [],
  };
}

/**
 * Sanitize a model answer against the retrieved rule set. Always returns a
 * safe TdAnswer (source:'ai'). citations/labels are rebuilt from the corpus —
 * the model's own labels are ignored.
 */
export function validateAnswer(raw: RawModelAnswer, retrieved: TdRule[]): TdAnswer {
  const byId = new Map(retrieved.map((r) => [r.id, r]));

  const citations: TdCitation[] = (raw.citations ?? [])
    .map((c) => (c.ruleId ? byId.get(c.ruleId) : undefined))
    .filter((r): r is TdRule => !!r)
    .map((r) => ({ ruleId: r.id, label: r.citationLabel, kind: r.citationKind }));
  // dedupe by ruleId, preserve order
  const seen = new Set<string>();
  const validCitations = citations.filter((c) => (seen.has(c.ruleId) ? false : seen.add(c.ruleId)));

  const needMore = (raw.needMoreInfoVi ?? []).filter((s) => s && s.trim());

  if (validCitations.length === 0) return noBasisAnswer(needMore);

  // Fabricated rule-number scan across all prose the model wrote.
  const prose = [raw.recommendationVi, raw.reasoningVi, raw.houseRuleOptionVi]
    .filter(Boolean)
    .join(" ");
  const mentioned = numbersIn(prose);
  const allowed = allowedNumbers(retrieved);
  const fabricated = [...mentioned].some((n) => !allowed.has(n));

  let confidence: TdConfidence = raw.confidence ?? "medium";
  if (fabricated) confidence = "low";

  return {
    source: "ai",
    isDemo: false,
    recommendationVi: (raw.recommendationVi ?? "").trim() || TD_NO_BASIS_RECOMMENDATION_VI,
    citations: validCitations,
    reasoningVi: (raw.reasoningVi ?? "").trim(),
    houseRuleOptionVi:
      (raw.houseRuleOptionVi ?? "").trim() ||
      "Ưu tiên luật CLB đã công bố và để TD quyết định cuối cùng.",
    playerWordingVi: (raw.playerWordingVi ?? "").trim(),
    confidence,
    needMoreInfoVi: fabricated
      ? ["Mô hình có thể nhắc tới quy tắc ngoài căn cứ — TD kiểm tra kỹ trước khi áp dụng.", ...needMore]
      : needMore,
    matchedRuleIds: validCitations.map((c) => c.ruleId),
  };
}
