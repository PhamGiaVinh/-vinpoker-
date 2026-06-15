import type { TdAnswer, TdConfidence, TdRule, TdRuleCategory, TdSituation } from "./types";
import { searchRules, type TdSearchHit } from "./localSearch";

// Builds the fixed answer-card payload from local keyword hits ONLY — no
// synthesis beyond a fixed template, no invented rule text, no LLM. Every
// answer is isDemo:true / source:'local'. Wording stays advisory
// ("Gợi ý xử lý", "Cần TD xác nhận") — never an authoritative ruling.

/** Shown verbatim by the answer card; also asserted by tests. */
export const TD_DEMO_NOTICE_VI =
  "DEMO — tra cứu từ khóa, chưa có AI, chưa phải ruling chính thức. Cần TD xác nhận.";

const MIN_MATCH_SCORE = 3; // below this → not enough to suggest anything

function confidenceFor(hits: TdSearchHit[]): TdConfidence {
  const top = hits[0]?.score ?? 0;
  const second = hits[1]?.score ?? 0;
  if (top >= 8 && top - second >= 3) return "high";
  if (top >= 5) return "medium";
  return "low";
}

function buildQuery(s: TdSituation): string {
  return [s.description, s.actionSequence, s.playersInvolved].filter(Boolean).join(" ");
}

// Advisory prefix per domain. Ruling/floor keep the "DEMO … cần TD xác nhận"
// wording (also asserted by tests); operations/strategy read as consulting, not
// a ruling. The whole card still shows the DEMO banner regardless.
function recommendationPrefix(category: TdRuleCategory | undefined): string {
  switch (category) {
    case "operations":
      return "Gợi ý vận hành (tra cứu offline — cân nhắc theo luật giải): ";
    case "strategy":
      return "Tư vấn tham khảo (tra cứu offline — chỉ mang tính định hướng): ";
    case "floor":
    case "ruling":
    default:
      return "Gợi ý xử lý (DEMO, cần TD xác nhận): ";
  }
}

function missingInfoPrompts(s: TdSituation): string[] {
  const out: string[] = [];
  if (!s.street) out.push("Sự việc xảy ra ở vòng nào (preflop/flop/turn/river/showdown)?");
  if (!s.playersInvolved?.trim()) out.push("Những ai liên quan và vị trí của họ?");
  if (!s.actionSequence?.trim()) out.push("Trình tự hành động cụ thể trước khi xảy ra?");
  return out;
}

/**
 * Pure: situation → TdAnswer. With no confident hit, returns a "need more
 * info" answer (no citations, low confidence) instead of guessing.
 */
export function buildLocalAnswer(situation: TdSituation, rules: TdRule[]): TdAnswer {
  const hits = searchRules(buildQuery(situation), rules);
  const confident = hits.length > 0 && hits[0].score >= MIN_MATCH_SCORE;

  if (!confident) {
    return {
      source: "local",
      isDemo: true,
      recommendationVi:
        "Chưa đủ thông tin để tra cứu từ khóa. Cần TD xác nhận trực tiếp tại bàn.",
      citations: [],
      reasoningVi:
        "Không tìm thấy quy tắc demo phù hợp với mô tả. Đây chỉ là công cụ tra cứu từ khóa, không phải ruling chính thức.",
      houseRuleOptionVi:
        "Ưu tiên luật CLB đã công bố và để TD/chủ CLB quyết định cuối cùng.",
      playerWordingVi:
        "Anh/chị cho em xin thêm chi tiết để em kiểm tra và mời TD xác nhận giúp mình nhé.",
      confidence: "low",
      needMoreInfoVi: [
        "Mô tả rõ hơn tình huống tranh chấp.",
        ...missingInfoPrompts(situation),
      ],
      matchedRuleIds: [],
    };
  }

  const top = hits.slice(0, 3);
  const topRule = top[0].rule;
  const houseNote = situation.houseRuleNote?.trim();

  return {
    source: "local",
    isDemo: true,
    recommendationVi: `${recommendationPrefix(topRule.category)}${topRule.suggestionVi}`,
    citations: top.map((h) => ({
      ruleId: h.rule.id,
      label: h.rule.citationLabel,
      kind: h.rule.citationKind,
    })),
    reasoningVi: top.map((h) => `${h.rule.topicVi}: ${h.rule.summaryVi}`).join(" "),
    houseRuleOptionVi: houseNote
      ? `Ghi chú luật CLB: ${houseNote}. Nếu luật CLB khác chuẩn TDA, ưu tiên luật CLB đã công bố và để TD quyết định.`
      : "Nếu CLB có luật riêng khác chuẩn TDA, ưu tiên luật CLB đã công bố và để TD quyết định cuối cùng.",
    playerWordingVi: topRule.playerWordingVi,
    confidence: confidenceFor(hits),
    needMoreInfoVi: missingInfoPrompts(situation),
    matchedRuleIds: top.map((h) => h.rule.id),
  };
}
