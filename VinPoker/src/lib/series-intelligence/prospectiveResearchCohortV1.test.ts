import { describe, expect, it } from "vitest";
import {
  PROSPECTIVE_HORIZONS,
  PROSPECTIVE_RESEARCH_COHORT_VERSION,
  PROSPECTIVE_RESEARCH_HORIZON_POLICY_V1,
  buildNativeTruthPromotionQueueV1,
  buildProspectiveEngineSnapshotV1,
  buildProspectiveResearchQueueV1,
  classifyProspectiveHorizon,
  horizonDueAt,
} from "./prospectiveResearchCohortV1";
import type { SeriesEvent } from "./nativeData";

const TARGET = "2026-09-01T12:00:00.000Z";
const HISTORY: SeriesEvent[] = Array.from({ length: 12 }, (_, index) => ({
  event_id: `history-${index}`,
  event_name: "Main Event",
  event_date: new Date(Date.parse("2026-05-01T12:00:00.000Z") + index * 7 * 86_400_000).toISOString(),
  buy_in: 1_000_000,
  fee: 100_000,
  serviceFeeAmount: 0,
  gtd: 10_000_000,
  prize_pool_actual: null,
  total_entries: 80 + index,
  unique_entries: null,
  reentries: null,
  capacity: null,
  source: "native",
  clubId: "club-1",
  missingFields: [],
}));
const EVENT: SeriesEvent = {
  event_id: "future-1",
  event_name: "Main Event",
  event_date: TARGET,
  buy_in: 1_000_000,
  fee: 100_000,
  serviceFeeAmount: 0,
  gtd: 10_000_000,
  prize_pool_actual: null,
  total_entries: null,
  unique_entries: null,
  reentries: null,
  capacity: null,
  source: "native",
  clubId: "club-1",
  missingFields: [],
};

describe("prospective horizon policy v1", () => {
  it("has a stable policy identity and ordered horizons", () => {
    expect(PROSPECTIVE_RESEARCH_HORIZON_POLICY_V1).toBe("series-research-horizon-policy-v1");
    expect(PROSPECTIVE_HORIZONS).toEqual(["T-21", "T-7", "T-1", "T-0"]);
    expect(PROSPECTIVE_RESEARCH_COHORT_VERSION).toBe("series-prospective-research-cohort-v1");
  });

  const statusCases = [
    ["T-21", "2026-08-10T11:00:00.000Z", "NOT_YET_DUE"],
    ["T-21", "2026-08-11T11:59:00.000Z", "ON_TIME"],
    ["T-21", "2026-08-11T12:01:00.000Z", "LATE_WITHIN_ALLOWED_WINDOW"],
    ["T-21", "2026-08-12T12:01:00.000Z", "MISSED"],
    ["T-7", "2026-08-25T11:00:00.000Z", "NOT_YET_DUE"],
    ["T-7", "2026-08-25T11:59:00.000Z", "ON_TIME"],
    ["T-7", "2026-08-25T12:01:00.000Z", "LATE_WITHIN_ALLOWED_WINDOW"],
    ["T-7", "2026-08-26T12:01:00.000Z", "MISSED"],
    ["T-1", "2026-08-31T11:00:00.000Z", "NOT_YET_DUE"],
    ["T-1", "2026-08-31T11:59:00.000Z", "ON_TIME"],
    ["T-1", "2026-08-31T12:01:00.000Z", "LATE_WITHIN_ALLOWED_WINDOW"],
    ["T-1", "2026-08-31T18:01:00.000Z", "MISSED"],
    ["T-0", "2026-09-01T11:00:00.000Z", "NOT_YET_DUE"],
    ["T-0", "2026-09-01T11:59:00.000Z", "ON_TIME"],
    ["T-0", "2026-09-01T12:00:00.000Z", "MISSED"],
    ["T-0", "2026-09-01T12:01:00.000Z", "MISSED"],
  ] as const;
  it.each(statusCases)("classifies %s at %s as %s", (horizon, asOf, expected) => {
    expect(classifyProspectiveHorizon(horizon, TARGET, asOf)).toBe(expected);
  });

  it("uses canonical UTC due timestamps", () => {
    expect(horizonDueAt("T-7", "2026-09-01T14:00:00+02:00")).toBe("2026-08-25T12:00:00.000Z");
  });
});

describe("prospective cohort queue", () => {
  const queueAt = (asOfTs: string, snapshots = [], packets = [], actuals = []) => buildProspectiveResearchQueueV1({
    asOfTs,
    events: [{ event: EVENT, status: "scheduled" }],
    snapshots,
    packets,
    actuals,
  });

  it("emits four deterministic rows for one future event", () => {
    const first = queueAt("2026-08-11T11:59:00.000Z");
    const second = queueAt("2026-08-11T11:59:00.000Z");
    expect(first).toEqual(second);
    expect(first.rows).toHaveLength(4);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.rows)).toBe(true);
  });

  it("sorts events by target time then id", () => {
    const secondEvent = { ...EVENT, event_id: "future-0", event_date: "2026-08-20T12:00:00.000Z" };
    const queue = buildProspectiveResearchQueueV1({ asOfTs: "2026-08-01T00:00:00.000Z", events: [{ event: EVENT }, { event: secondEvent }] });
    expect(queue.rows[0].eventId).toBe("future-0");
  });

  it("skips past events and invalid event dates", () => {
    const queue = buildProspectiveResearchQueueV1({
      asOfTs: "2026-08-01T00:00:00.000Z",
      events: [{ event: { ...EVENT, event_id: "past", event_date: "2026-07-01T00:00:00.000Z" } }, { event: { ...EVENT, event_id: "bad", event_date: "bad" } }],
    });
    expect(queue.rows).toEqual([]);
  });

  it.each(Array.from({ length: 24 }, (_, index) => index))("does not mutate queue inputs case %s", (index) => {
    const snapshots = [{ id: `snapshot-${index}`, eventId: EVENT.event_id, horizon: "T-21", targetEventTs: TARGET, forecastInstanceId: null, inputContentHash: null }];
    const queue = queueAt("2026-08-11T11:59:00.000Z", snapshots);
    expect(queue.rows.find((row) => row.horizon === "T-21")?.forecastState).toBe("captured");
    expect(snapshots[0].horizon).toBe("T-21");
  });

  it.each(Array.from({ length: 24 }, (_, index) => index))("returns the same next action for stable input case %s", (index) => {
    const queue = queueAt("2026-08-11T11:59:00.000Z");
    expect(queue.rows.find((row) => row.horizon === "T-21")?.nextAction).toBe("capture_forecast");
  });

  it.each(Array.from({ length: 24 }, (_, index) => index))("does not invent packet or actual state case %s", (index) => {
    const queue = queueAt("2026-08-11T11:59:00.000Z");
    const row = queue.rows[index % 4];
    expect(row.packetState).toBe("not_loaded");
    expect(row.actualState).toBe("not_loaded");
    expect(row.evaluationState).toBe("not_started");
  });

  it("recognizes an existing snapshot and packet without overwriting it", () => {
    const snapshot = { id: "snapshot-1", eventId: EVENT.event_id, horizon: "T-21", targetEventTs: TARGET, forecastInstanceId: "id", inputContentHash: "hash" };
    const queue = queueAt("2026-08-11T11:59:00.000Z", [snapshot], [{ eventId: EVENT.event_id, horizon: "T-21", packetId: "packet-1", state: "draft" }]);
    const row = queue.rows.find((item) => item.horizon === "T-21");
    expect(row).toMatchObject({ forecastState: "captured", packetState: "draft", nextAction: "evaluation_pending", snapshotId: "snapshot-1", packetId: "packet-1" });
  });

  it("ignores malformed existing snapshot timestamps without crashing", () => {
    const malformed = { id: "snapshot-bad", eventId: EVENT.event_id, horizon: "T-21", targetEventTs: "not-a-date", forecastInstanceId: null, inputContentHash: null };
    const queue = queueAt("2026-08-11T11:59:00.000Z", [malformed]);
    expect(queue.rows.find((item) => item.horizon === "T-21")).toMatchObject({ forecastState: "due", nextAction: "capture_forecast", snapshotId: null });
  });
});

describe("native outcome promotion queue", () => {
  it("only returns completed, non-cancelled events in deterministic order", () => {
    expect(buildNativeTruthPromotionQueueV1({
      asOfTs: "2026-08-08T00:00:00.000Z",
      events: [
        { id: "future", start_time: "2026-09-01T00:00:00Z", status: "scheduled" },
        { id: "cancelled", start_time: "2026-08-01T00:00:00Z", status: "cancelled" },
        { id: "past", start_time: "2026-08-01T00:00:00Z", status: "completed" },
      ],
    })).toEqual([{ eventId: "past", startTime: "2026-08-01T00:00:00.000Z" }]);
  });
});

describe("engine-origin snapshot builder", () => {
  it("builds a prospective engine snapshot using the existing forecast and provenance engines", async () => {
    const result = await buildProspectiveEngineSnapshotV1({ event: EVENT, history: HISTORY, horizon: "T-7", capturedAt: "2026-08-25T11:59:00.000Z", codeSha: "a".repeat(40) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.insert).toMatchObject({ event_id: EVENT.event_id, horizon: "T-7", source_label: "engine", provenance_kind: "engine", forecast_identity_eligible: true });
    expect(result.insert.forecast_issued_at).toBe("2026-08-25T11:59:00.000Z");
    expect(result.insert.target_event_ts).toBe(TARGET);
    expect(result.insert.notes).not.toContain("actual");
  });

  it("keeps unknown code SHA auditable but ineligible", async () => {
    const result = await buildProspectiveEngineSnapshotV1({ event: EVENT, history: HISTORY, horizon: "T-7", capturedAt: "2026-08-25T11:59:00.000Z" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.insert.code_sha).toBe("unknown");
    expect(result.insert.forecast_identity_eligible).toBe(false);
  });

  it.each([
    ["missing date", { ...EVENT, event_date: null }, "invalid_event_time"],
    ["missing buy-in", { ...EVENT, buy_in: null }, "invalid_buy_in"],
    ["started event", EVENT, "event_already_started"],
  ] as const)("fails closed for %s", async (_label, event, expected) => {
    const result = await buildProspectiveEngineSnapshotV1({ event, history: HISTORY, horizon: "T-7", capturedAt: event === EVENT ? TARGET : "2026-08-25T11:59:00.000Z" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(expected);
  });

  it("does not use a target outcome as a feature", async () => {
    const withTargetOutcome = { ...EVENT, total_entries: 9999, unique_entries: 9999, reentries: 9999 };
    const a = await buildProspectiveEngineSnapshotV1({ event: EVENT, history: HISTORY, horizon: "T-7", capturedAt: "2026-08-25T11:59:00.000Z", codeSha: "a".repeat(40) });
    const b = await buildProspectiveEngineSnapshotV1({ event: withTargetOutcome, history: HISTORY, horizon: "T-7", capturedAt: "2026-08-25T11:59:00.000Z", codeSha: "a".repeat(40) });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.insert.training_data_hash).toBe(b.insert.training_data_hash);
  });

  it("excludes history that was not available at the capture timestamp", async () => {
    const futureAtCapture = { ...HISTORY[HISTORY.length - 1], event_id: "future-at-capture", event_date: "2026-08-26T12:00:00.000Z", total_entries: 9999 };
    const a = await buildProspectiveEngineSnapshotV1({ event: EVENT, history: HISTORY, horizon: "T-7", capturedAt: "2026-08-25T11:59:00.000Z", codeSha: "a".repeat(40) });
    const b = await buildProspectiveEngineSnapshotV1({ event: EVENT, history: [...HISTORY, futureAtCapture], horizon: "T-7", capturedAt: "2026-08-25T11:59:00.000Z", codeSha: "a".repeat(40) });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(b.insert.training_data_hash).toBe(a.insert.training_data_hash);
      expect(b.insert.input_content_hash).toBe(a.insert.input_content_hash);
      expect(b.forecast).toEqual(a.forecast);
    }
  });
});
