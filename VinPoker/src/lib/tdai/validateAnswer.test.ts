import { describe, expect, it } from "vitest";
import { validateAnswer, TD_NO_BASIS_RECOMMENDATION_VI, type RawModelAnswer } from "./validateAnswer";
import type { TdRule } from "./types";

const RETRIEVED: TdRule[] = [
  {
    id: "string-bet",
    topicEn: "String bet", topicVi: "Đặt cược chuỗi",
    summaryEn: "x", summaryVi: "y", keywords: [],
    suggestionVi: "s", playerWordingVi: "p",
    citationLabel: "Tóm tắt TDA #44", citationKind: "tda_summary", source: "summary",
  },
  {
    id: "verbal-declaration",
    topicEn: "Verbal", topicVi: "Tuyên bố miệng",
    summaryEn: "x", summaryVi: "y", keywords: [],
    suggestionVi: "s", playerWordingVi: "p",
    citationLabel: "Tóm tắt TDA #47", citationKind: "tda_summary", source: "summary",
  },
];

const goodRaw: RawModelAnswer = {
  recommendationVi: "Tính theo lần đưa chip đầu.",
  citations: [{ ruleId: "string-bet" }, { ruleId: "verbal-declaration" }],
  reasoningVi: "Theo Tóm tắt TDA #44 và #47.",
  houseRuleOptionVi: "Ưu tiên luật CLB.",
  playerWordingVi: "Anh ơi...",
  confidence: "high",
  needMoreInfoVi: ["Ghế 3 có nói gì không?"],
};

describe("validateAnswer", () => {
  it("keeps valid citations and rebuilds labels from the corpus", () => {
    const a = validateAnswer(goodRaw, RETRIEVED);
    expect(a.source).toBe("ai");
    expect(a.isDemo).toBe(false);
    expect(a.citations.map((c) => c.ruleId)).toEqual(["string-bet", "verbal-declaration"]);
    expect(a.citations[0].label).toBe("Tóm tắt TDA #44"); // from corpus, not the model
    expect(a.confidence).toBe("high");
    expect(a.matchedRuleIds).toEqual(["string-bet", "verbal-declaration"]);
  });

  it("drops a citation whose ruleId is not in the retrieved set", () => {
    const a = validateAnswer(
      { ...goodRaw, citations: [{ ruleId: "string-bet" }, { ruleId: "made-up-rule" }] },
      RETRIEVED,
    );
    expect(a.citations.map((c) => c.ruleId)).toEqual(["string-bet"]);
  });

  it("flags an out-of-set rule number in prose and forces confidence low", () => {
    const a = validateAnswer(
      { ...goodRaw, reasoningVi: "Theo Quy tắc #99 thì xử như vậy.", confidence: "high" },
      RETRIEVED,
    );
    expect(a.confidence).toBe("low");
    expect(a.needMoreInfoVi.join(" ")).toMatch(/ngoài căn cứ/);
  });

  it("does NOT flag in-set rule numbers", () => {
    const a = validateAnswer({ ...goodRaw, reasoningVi: "Theo TDA #44.", confidence: "high" }, RETRIEVED);
    expect(a.confidence).toBe("high");
  });

  it("returns the no-basis template when zero valid citations remain", () => {
    const a = validateAnswer({ ...goodRaw, citations: [{ ruleId: "nope" }] }, RETRIEVED);
    expect(a.recommendationVi).toBe(TD_NO_BASIS_RECOMMENDATION_VI);
    expect(a.citations).toEqual([]);
    expect(a.confidence).toBe("low");
    expect(a.matchedRuleIds).toEqual([]);
  });

  it("dedupes repeated citations", () => {
    const a = validateAnswer(
      { ...goodRaw, citations: [{ ruleId: "string-bet" }, { ruleId: "string-bet" }] },
      RETRIEVED,
    );
    expect(a.citations).toHaveLength(1);
  });
});
