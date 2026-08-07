import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const getDecisionEventState = vi.hoisted(() => vi.fn());

vi.mock("@/lib/series-intelligence/decisionPacketRpc", () => ({
  createDecisionPacket: vi.fn(),
  freezeDecisionPacket: vi.fn(),
  getDecisionEventState,
  promoteNativeEventActual: vi.fn(),
  reconcileEventActual: vi.fn(),
  recordEventActual: vi.fn(),
}));

vi.mock("@/lib/series-intelligence/useSeriesCapture", () => ({
  useSeriesCapture: () => ({
    loading: false,
    saving: false,
    clubs: [{ id: "club-1", name: "Club test" }],
    clubId: "club-1",
    setClubId: vi.fn(),
    events: [{ id: "event-1", name: "Main Event", club_id: "club-1", start_time: "2026-08-08T03:00:00.000Z", status: "scheduled" }],
    snapshots: [],
    decisions: [],
    campaigns: [],
    registrations: [],
    reload: vi.fn(),
    insertForecast: vi.fn(),
    insertDecision: vi.fn(),
    updateDecision: vi.fn(),
    insertCampaign: vi.fn(),
    updateCampaign: vi.fn(),
    insertRegistration: vi.fn(),
  }),
}));

import { DecisionRoomV1 } from "./DecisionRoomV1";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const state = {
  version: "series-decision-event-state-v1" as const,
  event: { eventId: "event-1", clubId: "club-1", status: "scheduled", targetEventTs: "2026-08-08T03:00:00.000Z" },
  decisionPackets: [],
  actualTruth: { state: "unavailable" as const, reason: "no_revision" as const },
  scoring: { candidatePacketId: null, candidateActualRevisionId: null, targetMetric: null, eligibility: "blocked" as const, blockReasons: ["no_actual_revision"] },
  dataQuality: { legacyActualCacheAvailable: false, d2aRevisionAvailable: false, unresolvedMismatch: false, missingFields: [], unsupportedDerivationWarnings: [] },
};

describe("DecisionRoomV1", () => {
  it("renders an honest no-data state without fabricating a score or outcome", async () => {
    getDecisionEventState.mockResolvedValue({ ok: true, value: state });
    render(<DecisionRoomV1 />);

    await waitFor(() => expect(screen.getByTestId("decision-room-v1")).toBeInTheDocument());
    expect(screen.getByText("Chưa có kết quả")).toBeInTheDocument();
    expect(screen.getByText(/Chưa có bản ghi kết quả thật/)).toBeInTheDocument();
    expect(screen.getByText(/Room không tự tính điểm/)).toBeInTheDocument();
    expect(screen.queryByText(/probability|khuyến nghị|tối ưu/i)).toBeNull();
  });
});
