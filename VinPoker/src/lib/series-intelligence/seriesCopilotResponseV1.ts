export const SERIES_V_RESPONSE_VERSION = "series-v-response-v1" as const;

export type VOptionVerdictV1 = "supported" | "needs_review" | "blocked" | "insufficient_data";
export type VAnswerStatusV1 = "supported" | "limited" | "blocked";

export interface VOptionAssessmentV1 {
  optionId: string;
  verdict: VOptionVerdictV1;
  tradeoffs: readonly string[];
  evidenceRefs: readonly string[];
}
export interface VResponseV1 {
  version: typeof SERIES_V_RESPONSE_VERSION;
  summaryVi: string;
  optionAssessments: readonly VOptionAssessmentV1[];
  recommendedOptionId: string | null;
  missingDataIds: readonly string[];
  evidenceRefs: readonly string[];
  answerStatus: VAnswerStatusV1;
  humanDecisionRequired: true;
}

export interface VResponseValidationResultV1 {
  accepted: boolean;
  response: VResponseV1;
  issues: readonly string[];
  warnings: readonly string[];
}

export function blockedVResponseV1(): VResponseV1 {
  return Object.freeze({
    version: SERIES_V_RESPONSE_VERSION,
    summaryVi: "V chưa thể tạo câu trả lời có đủ bằng chứng.",
    optionAssessments: Object.freeze([]),
    recommendedOptionId: null,
    missingDataIds: Object.freeze([]),
    evidenceRefs: Object.freeze([]),
    answerStatus: "blocked",
    humanDecisionRequired: true,
  });
}
