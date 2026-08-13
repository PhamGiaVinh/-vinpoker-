import { describe, expect, it, vi } from "vitest";
import { createSeriesCopilotContextV1 } from "./seriesCopilotContextV1";
import { askSeriesCopilotEdgeV1 } from "./seriesCopilotEdgeClient";
import { buildScheduleHealthV1 } from "./scheduleHealthV1";
import {
  buildServerCopilotContextV1,
  unavailableScheduleInputsV1,
} from "../../../supabase/functions/series-intelligence-copilot/serverContext";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));

const CLUB_ID = "11111111-1111-4111-8111-111111111111";
const LEGACY_CLUB_ID = "22222222-2222-2222-2222-222222222222";
const REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AS_OF = "2026-08-09T03:00:00.000Z";

function serverPulse() {
  const metric = (metricId: string, value: number) => ({
    metricId,
    value,
    unit: "count",
    availability: "exact",
    privacyState: "safe",
    asOf: AS_OF,
    sourceId: `source_${metricId}`,
    grain: "club",
    definitionVersion: `${metricId}_v1`,
  });
  return {
    version: "series-club-live-pulse-v1",
    clubId: CLUB_ID,
    asOf: AS_OF,
    clubMemberProfiles: metric("club_member_profiles", 100),
    uniquePlayersToday: metric("unique_players_today", 12),
    entriesToday: metric("entries_today", 18),
    playersPlayingNow: metric("players_playing_now", 9),
    runningEvents: metric("running_events", 2),
    openTables: metric("open_tables", 4),
    dealersOnDuty: metric("dealers_on_duty", 8),
  };
}

async function trustedEnvelope() {
  const evidence = [{
    evidenceId: "club_pulse_server",
    labelVi: "Club Pulse owner aggregate",
    sourceId: "get_series_club_live_pulse_v1",
    asOf: AS_OF,
    quality: "owner_scoped_server_aggregate" as const,
    privacyState: "safe" as const,
    metricIds: ["entries_today"],
  }];
  const context = await createSeriesCopilotContextV1({
    asOf: AS_OF,
    clubPulse: {
      version: "series-club-pulse-v1",
      sourceMode: "server_aggregate",
      metrics: [{
        metricId: "entries_today",
        value: 18,
        unit: "count",
        availability: "exact",
        privacyState: "safe",
        asOf: AS_OF,
        sourceId: "tournaments.tournament_registrations",
        grain: "club_event_start_local_calendar_day",
        definitionVersion: "club-entries-event-day-v1",
      }],
    },
    scheduleHealth: {
      version: "series-schedule-health-v1",
      overallState: "blocked",
      assessedOptionIds: [],
      dimensions: [
        ["structure_completeness", "Structure"],
        ["demand_evidence", "Demand"],
        ["gtd_stress", "GTD"],
        ["schedule_collision", "Collision"],
        ["operational_feasibility", "Operations"],
        ["data_readiness", "Data"],
      ].map(([key, labelVi]) => ({
        key: key as "structure_completeness" | "demand_evidence" | "gtd_stress" | "schedule_collision" | "operational_feasibility" | "data_readiness",
        labelVi,
        state: key === "data_readiness" ? "blocked" as const : "insufficient_data" as const,
        detailVi: "Evidence is incomplete.",
        evidenceRefs: key === "demand_evidence" ? ["club_pulse_server"] : [],
      })),
    },
    candidateOptions: [],
    dataGaps: [{
      dataGapId: "gap_approved_schedule_candidates",
      titleVi: "No approved schedule candidate",
      detailVi: "An owner-approved server candidate is required.",
      severity: "critical",
      blocksRecommendation: true,
      requiredSourceVi: "Approved server-side schedule candidate",
    }],
    evidence,
  });
  return {
    context,
    response: {
      version: "series-v-response-v1",
      summaryVi: "Club Pulse is available; no schedule candidate is approved.",
      optionAssessments: [],
      recommendedOptionId: null,
      missingDataIds: ["gap_approved_schedule_candidates"],
      evidenceRefs: ["club_pulse_server"],
      answerStatus: "blocked",
      humanDecisionRequired: true,
    },
    receipt: {
      provider: "gemini",
      modelId: "gemini-3.6-flash",
      contextHash: context.contextHash,
      promptContractVersion: "series-v-prompt-policy-v1",
      responseContractVersion: "series-v-response-v1",
      validatorVersion: "series-v-edge-validator-v1",
      latencyMs: 12,
      inputTokens: 100,
      outputTokens: 40,
      validationState: "accepted",
      rateLimitScope: "actor_club_global",
    },
  };
}

describe("Series Copilot Edge client", () => {
  it("keeps browser and Edge Schedule Health semantics identical", async () => {
    const serverContext = await buildServerCopilotContextV1(serverPulse(), CLUB_ID, unavailableScheduleInputsV1());
    const browserHealth = buildScheduleHealthV1({
      clubPulse: serverContext.clubPulse,
      candidateOptions: serverContext.candidateOptions,
      dataGaps: serverContext.dataGaps,
      evidence: serverContext.evidence,
    });
    expect(browserHealth).toEqual(serverContext.scheduleHealth);
  });

  it("sends only the minimal request and accepts a matching server context", async () => {
    const envelope = await trustedEnvelope();
    const invoke = vi.fn(async () => ({ data: envelope, error: null }));
    const result = await askSeriesCopilotEdgeV1({
      clubId: CLUB_ID,
      untrustedQuestion: "  Lịch nào phù hợp?  ",
      selectedOptionIds: [],
    }, { invoke, requestId: () => REQUEST_ID });

    expect(invoke).toHaveBeenCalledWith({
      version: "series-v-request-v1",
      requestId: REQUEST_ID,
      clubId: CLUB_ID,
      question: "Lịch nào phù hợp?",
      selectedOptionIds: [],
    }, undefined);
    expect(result.contextHash).toBe(envelope.context.contextHash);
    expect(result.validation).toMatchObject({ accepted: true, response: { answerStatus: "blocked", recommendedOptionId: null } });
    expect(result.receipt.modelId).toBe("gemini-3.6-flash");
  });

  it("sends a legacy PostgreSQL club UUID to the owner-scoped Edge boundary", async () => {
    const envelope = await trustedEnvelope();
    const invoke = vi.fn(async () => ({ data: envelope, error: null }));
    await expect(askSeriesCopilotEdgeV1({
      clubId: LEGACY_CLUB_ID,
      untrustedQuestion: "Kiá»ƒm tra dá»¯ liá»‡u lá»‹ch",
    }, { invoke, requestId: () => REQUEST_ID })).resolves.toMatchObject({ contextHash: envelope.context.contextHash });
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ clubId: LEGACY_CLUB_ID }), undefined);
  });

  it("fails closed on a forged context identity", async () => {
    const envelope = await trustedEnvelope();
    const forged = structuredClone(envelope);
    forged.context.contextHash = "0".repeat(64);
    await expect(askSeriesCopilotEdgeV1({ clubId: CLUB_ID, untrustedQuestion: "Đánh giá lịch" }, {
      invoke: async () => ({ data: forged, error: null }),
      requestId: () => REQUEST_ID,
    })).rejects.toThrow("COPILOT_CONTEXT_IDENTITY_MISMATCH");
  });

  it("rejects malformed envelopes and Edge failures", async () => {
    const envelope = await trustedEnvelope();
    await expect(askSeriesCopilotEdgeV1({ clubId: CLUB_ID, untrustedQuestion: "Đánh giá lịch" }, {
      invoke: async () => ({ data: { ...envelope, extra: true }, error: null }),
      requestId: () => REQUEST_ID,
    })).rejects.toThrow("COPILOT_EDGE_RESPONSE_INVALID");
    await expect(askSeriesCopilotEdgeV1({ clubId: CLUB_ID, untrustedQuestion: "Đánh giá lịch" }, {
      invoke: async () => ({ data: null, error: new Error("network detail") }),
      requestId: () => REQUEST_ID,
    })).rejects.toThrow("COPILOT_EDGE_UNAVAILABLE");
  });
});
