import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc },
}));

import {
  SERIES_CANDIDATE_AUTHORING_RPC,
  approveSeriesCandidateFromTournament,
  getSeriesCandidateAuthoringPreview,
  listSeriesCandidateAuthoringSources,
  parseSeriesCandidateAuthoringPreview,
} from "./seriesCandidateAuthoringRpc";

const CLUB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOURNAMENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OPTION_ID = `tournament:${TOURNAMENT_ID}`;

const sourceEnvelope = {
  version: "series-v-candidate-authoring-sources-v1",
  clubId: CLUB_ID,
  asOf: "2026-08-14T12:00:00.000Z",
  sources: [{
    tournamentId: TOURNAMENT_ID,
    labelVi: "Main Event thật",
    scheduledStartAt: "2026-08-20T12:00:00.000Z",
    optionId: OPTION_ID,
  }],
};

const previewEnvelope = {
  version: "series-v-candidate-authoring-preview-v1",
  clubId: CLUB_ID,
  tournamentId: TOURNAMENT_ID,
  optionId: OPTION_ID,
  asOf: "2026-08-14T12:00:00.000Z",
  state: "ready",
  blockers: [],
  fields: {
    eventName: { value: "Main Event thật", source: "club_schedule" },
    scheduledStartAt: { value: "2026-08-20T12:00:00.000Z", source: "club_schedule" },
    buyInVnd: { value: "3000000", source: "club_schedule" },
    scheduleGtdVnd: { value: null, source: "owner_input" },
    feeVnd: { value: "300000", source: "club_schedule" },
    serviceFeeVnd: { value: null, source: "missing" },
    prizeContributionPerEntryVnd: { value: null, source: "owner_input" },
    flights: { value: null, source: "owner_input" },
    expectedDurationMinutes: { value: null, source: "owner_input" },
    structureState: { value: "incomplete", source: "deterministic" },
    capacityState: { value: "unknown", source: "missing" },
    collisionState: { value: "unknown", source: "missing" },
  },
};

const approvalEnvelope = {
  version: "series-schedule-candidate-approval-v1",
  candidateId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  optionId: OPTION_ID,
  revision: 1,
  lifecycle: "approved",
  sourceFingerprint: "a".repeat(64),
};

const approvedReadback = {
  version: "series-approved-schedule-candidates-v1",
  clubId: CLUB_ID,
  asOf: "2026-08-14T12:00:01.000Z",
  candidateOptions: [{
    optionId: OPTION_ID,
    labelVi: "Main Event thật",
    buyIn: { amountMinor: "3000000", currency: "VND", scale: 0 },
    gtd: { amountMinor: "2000000000", currency: "VND", scale: 0 },
    flights: 1,
    expectedDurationMinutes: null,
    requiredField: null,
    structureState: "incomplete",
    capacityState: "unknown",
    collisionState: "unknown",
    gtdStressState: "unknown",
    evidenceRefs: [`tournament:${TOURNAMENT_ID}`],
  }],
  evidence: [{
    evidenceId: `tournament:${TOURNAMENT_ID}`,
    labelVi: "Lịch CLB: Main Event thật",
    sourceId: "tournaments",
    asOf: "2026-08-14T12:00:00.000Z",
    quality: "owner_scoped_server_aggregate",
    privacyState: "safe",
    metricIds: ["event_name"],
  }],
  dataGaps: [],
};

beforeEach(() => rpc.mockReset());

describe("seriesCandidateAuthoringRpc", () => {
  it("reads server-owned candidate sources and rejects malformed response fields", async () => {
    rpc.mockResolvedValueOnce({ data: sourceEnvelope, error: null });

    const result = await listSeriesCandidateAuthoringSources(CLUB_ID);

    expect(result).toEqual({ ok: true, value: sourceEnvelope.sources });
    expect(rpc).toHaveBeenCalledWith(SERIES_CANDIDATE_AUTHORING_RPC.listSources, { p_club_id: CLUB_ID });

    expect(parseSeriesCandidateAuthoringPreview({ ...previewEnvelope, unexpected: true })).toEqual({
      ok: false,
      error: "malformed_response",
      retryable: false,
    });
  });

  it("binds a preview to the exact selected club and tournament", async () => {
    rpc.mockResolvedValueOnce({ data: previewEnvelope, error: null });

    const result = await getSeriesCandidateAuthoringPreview(CLUB_ID, TOURNAMENT_ID);

    expect(result).toEqual({ ok: true, value: previewEnvelope });
    expect(rpc).toHaveBeenCalledWith(SERIES_CANDIDATE_AUTHORING_RPC.preview, {
      p_club_id: CLUB_ID,
      p_tournament_id: TOURNAMENT_ID,
    });
  });

  it("fails closed when a source-list envelope is bound to another club", async () => {
    rpc.mockResolvedValueOnce({ data: { ...sourceEnvelope, clubId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }, error: null });

    await expect(listSeriesCandidateAuthoringSources(CLUB_ID)).resolves.toEqual({
      ok: false,
      error: "malformed_response",
      retryable: false,
    });
  });

  it("uses only the anchored server approval RPC and verifies exactly one approved readback", async () => {
    rpc
      .mockResolvedValueOnce({ data: approvalEnvelope, error: null })
      .mockResolvedValueOnce({ data: approvedReadback, error: null });

    const result = await approveSeriesCandidateFromTournament({
      clubId: CLUB_ID,
      tournamentId: TOURNAMENT_ID,
      gtdVnd: 2_000_000_000,
      prizeContributionPerEntryVnd: null,
      flights: 1,
      expectedDurationMinutes: null,
    });

    expect(result).toEqual({ ok: true, value: { approval: approvalEnvelope, candidate: approvedReadback.candidateOptions[0] } });
    expect(rpc.mock.calls).toEqual([
      [SERIES_CANDIDATE_AUTHORING_RPC.approveFromTournament, {
        p_club_id: CLUB_ID,
        p_tournament_id: TOURNAMENT_ID,
        p_gtd_vnd: 2_000_000_000,
        p_prize_contribution_per_entry_vnd: null,
        p_flights: 1,
        p_expected_duration_minutes: null,
      }],
      [SERIES_CANDIDATE_AUTHORING_RPC.approvedReadback, {
        p_club_id: CLUB_ID,
        p_option_ids: [OPTION_ID],
      }],
    ]);
    expect(rpc.mock.calls.flat().join(" ")).not.toContain("series_approve_schedule_candidate_v1");
  });

  it("fails closed when the approval readback is not exactly the selected candidate", async () => {
    rpc
      .mockResolvedValueOnce({ data: approvalEnvelope, error: null })
      .mockResolvedValueOnce({ data: { ...approvedReadback, candidateOptions: [] }, error: null });

    const result = await approveSeriesCandidateFromTournament({
      clubId: CLUB_ID,
      tournamentId: TOURNAMENT_ID,
      gtdVnd: 2_000_000_000,
      prizeContributionPerEntryVnd: null,
      flights: 1,
      expectedDurationMinutes: null,
    });

    expect(result).toEqual({ ok: false, error: "readback_mismatch", retryable: false });
  });

  it("rejects unsafe owner input before any server call", async () => {
    const result = await approveSeriesCandidateFromTournament({
      clubId: CLUB_ID,
      tournamentId: TOURNAMENT_ID,
      gtdVnd: 1.5,
      prizeContributionPerEntryVnd: null,
      flights: 0,
      expectedDurationMinutes: null,
    });

    expect(result).toEqual({ ok: false, error: "invalid_request", retryable: false });
    expect(rpc).not.toHaveBeenCalled();
  });
});
