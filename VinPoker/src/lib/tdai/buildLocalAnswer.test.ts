import { describe, expect, it } from "vitest";
import { buildLocalAnswer, TD_DEMO_NOTICE_VI } from "./buildLocalAnswer";
import { MOCK_TD_RULES } from "./mockRules";
import type { TdSituation } from "./types";

const base: TdSituation = { description: "" };

describe("buildLocalAnswer", () => {
  it("is always a labelled local demo answer", () => {
    const a = buildLocalAnswer({ ...base, description: "string bet" }, MOCK_TD_RULES);
    expect(a.source).toBe("local");
    expect(a.isDemo).toBe(true);
    // The demo notice constant is what the card renders verbatim.
    expect(TD_DEMO_NOTICE_VI).toContain("DEMO");
    expect(TD_DEMO_NOTICE_VI).toContain("chưa phải ruling chính thức");
  });

  it("builds a backed answer from the top rule hit with citations", () => {
    const a = buildLocalAnswer(
      { ...base, description: "khách đặt cược chuỗi", street: "flop", playersInvolved: "Seat 3 vs Seat 5", actionSequence: "raise nhiều lần" },
      MOCK_TD_RULES,
    );
    expect(a.matchedRuleIds[0]).toBe("string-bet");
    expect(a.citations.length).toBeGreaterThan(0);
    expect(a.citations[0].ruleId).toBe("string-bet");
    expect(a.recommendationVi).toContain("DEMO");
    expect(a.playerWordingVi.length).toBeGreaterThan(0);
    // advisory, never authoritative
    expect(a.recommendationVi).not.toContain("phải xử");
  });

  it("returns a need-more-info answer with no citations when nothing matches", () => {
    const a = buildLocalAnswer({ ...base, description: "xin chào, ăn tối chưa" }, MOCK_TD_RULES);
    expect(a.citations).toEqual([]);
    expect(a.matchedRuleIds).toEqual([]);
    expect(a.confidence).toBe("low");
    expect(a.needMoreInfoVi.length).toBeGreaterThan(0);
    expect(a.recommendationVi).toContain("Cần TD xác nhận");
  });

  it("raises confidence for a strong, unambiguous match", () => {
    const strong = buildLocalAnswer(
      { ...base, description: "string bet đặt cược chuỗi cược chuỗi raise nhiều lần" },
      MOCK_TD_RULES,
    );
    expect(["medium", "high"]).toContain(strong.confidence);
  });

  it("asks for missing situation fields in needMoreInfo", () => {
    const a = buildLocalAnswer({ ...base, description: "all in side pot" }, MOCK_TD_RULES);
    expect(a.needMoreInfoVi.join(" ")).toMatch(/vòng nào|liên quan|Trình tự/);
  });

  it("folds a house-rule note into the house-rule option", () => {
    const a = buildLocalAnswer(
      { ...base, description: "string bet", houseRuleNote: "CLB tính theo lần đưa chip đầu" },
      MOCK_TD_RULES,
    );
    expect(a.houseRuleOptionVi).toContain("CLB tính theo lần đưa chip đầu");
  });
});
