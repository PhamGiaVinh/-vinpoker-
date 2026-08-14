import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc },
}));
import type {
  ApprovedSeriesCandidateFromTournament,
  SeriesCandidateAuthoringPreview,
  SeriesCandidateAuthoringSource,
} from "@/lib/series-intelligence/seriesCandidateAuthoringRpc";
import { SeriesCandidateAuthoringPanel, type SeriesCandidateAuthoringApi } from "./SeriesCandidateAuthoringPanel";

const CLUB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOURNAMENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OPTION_ID = `tournament:${TOURNAMENT_ID}`;

const source: SeriesCandidateAuthoringSource = {
  tournamentId: TOURNAMENT_ID,
  labelVi: "Main Event thật",
  scheduledStartAt: "2026-08-20T12:00:00.000Z",
  optionId: OPTION_ID,
};

const readyPreview: SeriesCandidateAuthoringPreview = {
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

const approved: ApprovedSeriesCandidateFromTournament = {
  approval: {
    version: "series-schedule-candidate-approval-v1",
    candidateId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    optionId: OPTION_ID,
    revision: 1,
    lifecycle: "approved",
    sourceFingerprint: "a".repeat(64),
  },
  candidate: {
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
  },
};

function createApi(overrides: Partial<SeriesCandidateAuthoringApi> = {}): SeriesCandidateAuthoringApi {
  return {
    listSources: vi.fn().mockResolvedValue({ ok: true, value: [source] }),
    getPreview: vi.fn().mockResolvedValue({ ok: true, value: readyPreview }),
    approve: vi.fn().mockResolvedValue({ ok: true, value: approved }),
    ...overrides,
  };
}

afterEach(cleanup);

describe("SeriesCandidateAuthoringPanel", () => {
  it("promotes only an explicitly confirmed, server-previewed tournament and waits for readback", async () => {
    const api = createApi();
    render(<SeriesCandidateAuthoringPanel clubId={CLUB_ID} api={api} />);

    await screen.findByRole("option", { name: /Main Event thật/ });
    fireEvent.change(screen.getByLabelText("Chọn lịch CLB cho V"), { target: { value: TOURNAMENT_ID } });

    await screen.findByText("Thông tin server đã đọc");
    expect(screen.getAllByText("Từ lịch CLB").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Chưa có dữ liệu").length).toBeGreaterThan(0);
    expect(screen.getByText(/Không dùng buy-in để suy ra prize contribution/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("GTD phương án"), { target: { value: "2000000000" } });
    fireEvent.change(screen.getByLabelText("Số flight"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Xác nhận duyệt lịch cho V" }));

    const approveButton = screen.getByRole("button", { name: "Duyệt cho V phân tích" });
    await waitFor(() => expect(approveButton).toBeEnabled());
    fireEvent.click(approveButton);

    expect(await screen.findByTestId("series-candidate-approved")).toHaveTextContent("Server đã xác nhận phương án đã duyệt");
    expect(api.approve).toHaveBeenCalledWith({
      clubId: CLUB_ID,
      tournamentId: TOURNAMENT_ID,
      gtdVnd: 2_000_000_000,
      prizeContributionPerEntryVnd: null,
      flights: 1,
      expectedDurationMinutes: null,
    });
    expect(screen.queryByText(/optimal GTD|recommended GTD|chance of overlay|overlay probability/i)).toBeNull();
  });

  it("fails closed for a server-blocked schedule and never offers approval", async () => {
    const blockedPreview: SeriesCandidateAuthoringPreview = {
      ...readyPreview,
      state: "blocked",
      blockers: ["scheduled_start_required"],
    };
    const api = createApi({ getPreview: vi.fn().mockResolvedValue({ ok: true, value: blockedPreview }) });
    render(<SeriesCandidateAuthoringPanel clubId={CLUB_ID} api={api} />);

    await screen.findByRole("option", { name: /Main Event thật/ });
    fireEvent.change(screen.getByLabelText("Chọn lịch CLB cho V"), { target: { value: TOURNAMENT_ID } });

    expect(await screen.findByRole("alert")).toHaveTextContent("scheduled_start_required");
    expect(screen.getByRole("button", { name: "Duyệt cho V phân tích" })).toBeDisabled();
    expect(api.approve).not.toHaveBeenCalled();
  });

  it("keeps missing fields distinct from zero and reports when no eligible source exists", async () => {
    const api = createApi({ listSources: vi.fn().mockResolvedValue({ ok: true, value: [] }) });
    render(<SeriesCandidateAuthoringPanel clubId={CLUB_ID} api={api} />);

    expect(await screen.findByText(/Chưa có lịch CLB ở trạng thái scheduled/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue("0")).toBeNull();
    expect(api.getPreview).not.toHaveBeenCalled();
  });

  it("does not load or approve any schedule without a live Club Pulse club id", () => {
    const api = createApi();
    render(<SeriesCandidateAuthoringPanel clubId={null} api={api} />);

    expect(screen.getByText("Chọn Club Pulse thật trước khi duyệt một lịch cho V.")).toBeInTheDocument();
    expect(api.listSources).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Duyệt cho V phân tích" })).toBeDisabled();
  });
});
