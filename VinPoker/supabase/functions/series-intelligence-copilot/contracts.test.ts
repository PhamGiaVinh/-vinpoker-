import { describe, expect, it } from "vitest";
import { parseSeriesVRequestV1, validateProviderResponseV1 } from "./contracts";
import { buildServerCopilotContextV1, type ApprovedScheduleInputsV1 } from "./serverContext";
import { AS_OF, CLUB_ID, pulse } from "./serverContext.test";

const inputs: ApprovedScheduleInputsV1 = {
  evidence: [{ evidenceId: "schedule_review", labelVi: "Lịch đã duyệt", sourceId: "server_schedule", asOf: AS_OF, quality: "owner_scoped_server_aggregate", privacyState: "safe", metricIds: [] }],
  dataGaps: [{ dataGapId: "gap_capacity", titleVi: "Thiếu sức chứa", detailVi: "Cần xác nhận", severity: "important", blocksRecommendation: false, requiredSourceVi: "Capacity" }],
  candidateOptions: [{
    optionId: "option_a", labelVi: "Phương án A", buyIn: { amountMinor: "2000000", currency: "VND", scale: 0 },
    gtd: { amountMinor: "200000000", currency: "VND", scale: 0 }, flights: 2, expectedDurationMinutes: 600,
    requiredField: 100, structureState: "complete", capacityState: "unknown", collisionState: "clear",
    gtdStressState: "limited", evidenceRefs: ["schedule_review"],
  }],
};

async function context() { return buildServerCopilotContextV1(pulse(), CLUB_ID, inputs); }
function validResponse() {
  return {
    version: "series-v-response-v1", summaryVi: "Phương án cần owner xem lại.",
    optionAssessments: [{ optionId: "option_a", verdict: "needs_review", tradeoffs: ["GTD {{option:option_a:gtd}} cần đối chiếu."], evidenceRefs: ["schedule_review"] }],
    recommendedOptionId: "option_a", missingDataIds: ["gap_capacity"], evidenceRefs: ["schedule_review"], answerStatus: "supported", humanDecisionRequired: true,
  };
}

describe("V request and response trust boundary", () => {
  it("accepts only the minimal browser request", () => {
    expect(parseSeriesVRequestV1({ version: "series-v-request-v1", requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", clubId: CLUB_ID, question: "Nên chọn lịch nào?", selectedOptionIds: ["option_a"] }).question).toBe("Nên chọn lịch nào?");
    expect(() => parseSeriesVRequestV1({ version: "series-v-request-v1", requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", clubId: CLUB_ID, question: "x", entriesToday: 99 })).toThrow("not allowed");
    expect(() => parseSeriesVRequestV1({ version: "series-v-request-v1", requestId: "not-a-uuid", clubId: CLUB_ID, question: "x" })).toThrow("requestId");
  });

  it("derives answer status and accepts approved tokens", async () => {
    const result = validateProviderResponseV1(validResponse(), await context());
    expect(result.answerStatus).toBe("limited");
  });

  it.each([
    ["unknown evidence", (raw: ReturnType<typeof validResponse>) => { raw.evidenceRefs = ["stolen_rows"]; }],
    ["unknown option", (raw: ReturnType<typeof validResponse>) => { raw.optionAssessments[0].optionId = "option_x"; }],
    ["invented number", (raw: ReturnType<typeof validResponse>) => { raw.summaryVi = "Xác suất 75 phần trăm."; }],
    ["privacy leak token", (raw: ReturnType<typeof validResponse>) => { raw.summaryVi = "Có {{metric:unique_players_today}} player."; }],
    ["wrong schema", (raw: ReturnType<typeof validResponse>) => { (raw as Record<string, unknown>).extra = true; }],
  ])("rejects %s", async (_label, mutate) => {
    const raw = validResponse();
    mutate(raw);
    const trustedContext = await context();
    expect(() => validateProviderResponseV1(raw, trustedContext)).toThrow();
  });
});

export { inputs, validResponse };
