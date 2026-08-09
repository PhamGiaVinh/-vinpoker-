import { parseSeriesVRequestV1 } from "./contracts.ts";
import { parseApprovedScheduleInputsV1 } from "./serverContext.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("Series V request requires a stable request UUID", () => {
  const parsed = parseSeriesVRequestV1({
    version: "series-v-request-v1",
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    clubId: "11111111-1111-4111-8111-111111111111",
    question: "Nên cân nhắc lịch nào?",
    selectedOptionIds: [],
  });
  assert(parsed.requestId === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "request identity changed");
});

Deno.test("approved candidate parser fails unknown evidence closed", () => {
  let rejected = false;
  try {
    parseApprovedScheduleInputsV1({
      version: "series-approved-schedule-candidates-v1",
      clubId: "11111111-1111-4111-8111-111111111111",
      asOf: "2026-08-09T03:00:00.000Z",
      candidateOptions: [{
        optionId: "option_a",
        labelVi: "Phương án A",
        buyIn: { amountMinor: "2000000", currency: "VND", scale: 0 },
        gtd: { amountMinor: "200000000", currency: "VND", scale: 0 },
        flights: 2,
        expectedDurationMinutes: null,
        requiredField: null,
        structureState: "incomplete",
        capacityState: "unknown",
        collisionState: "unknown",
        gtdStressState: "unknown",
        evidenceRefs: ["missing_evidence"],
      }],
      evidence: [],
      dataGaps: [],
    }, "11111111-1111-4111-8111-111111111111");
  } catch {
    rejected = true;
  }
  assert(rejected, "unknown evidence was accepted");
});
