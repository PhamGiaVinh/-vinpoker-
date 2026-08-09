import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askMockSeriesCopilotV1, createMockSeriesCopilotContextV1 } from "@/lib/series-intelligence/seriesCopilotMockAdapter";
import { VCopilotPanel } from "./VCopilotPanel";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("VCopilotPanel", () => {
  it("renders the deterministic mock context, health dimensions and explicit data gaps", async () => {
    render(<VCopilotPanel />);

    expect(await screen.findByText("Hồ sơ trong CLB")).toBeInTheDocument();
    expect(screen.getByText("Sức khỏe lịch")).toBeInTheDocument();
    expect(screen.getByText("Dữ liệu còn thiếu")).toBeInTheDocument();
    expect(screen.getByText("Số người đang chơi chưa đủ mới")).toBeInTheDocument();
    expect(screen.getByText("Dữ liệu minh họa")).toBeInTheDocument();
  });

  it("shows the solving orb only during the mock request and renders the validated limited response", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const ask = vi.fn(async (request) => {
      await gate;
      if (!request.context) throw new Error("missing mock context");
      return askMockSeriesCopilotV1({ ...request, latencyMs: 0 });
    });
    render(<VCopilotPanel ask={ask} />);

    const button = await screen.findByRole("button", { name: "Hỏi V" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    expect(screen.getByTestId("v-thinking-indicator")).toBeInTheDocument();
    expect(screen.getByText("V is thinking…")).toBeInTheDocument();
    release?.();

    expect(await screen.findByTestId("v-response")).toBeInTheDocument();
    expect(screen.queryByTestId("v-thinking-indicator")).toBeNull();
    expect(screen.getByText("Kết luận có giới hạn")).toBeInTheDocument();
    expect(screen.getByText("6.000.000.000 ₫", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("V đang nghiêng về")).toBeInTheDocument();
    expect(screen.queryByText(/optimal GTD|chance of overlay|probability/i)).toBeNull();
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("has an accessible live status and no editable money field", async () => {
    render(<VCopilotPanel />);
    const button = await screen.findByRole("button", { name: "Hỏi V" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(document.querySelector('input[type="number"]')).toBeNull();
  });

  it("uses a supplied server aggregate without falling back to mock pulse values", async () => {
    render(<VCopilotPanel contextMode="live" clubId="11111111-1111-4111-8111-111111111111" clubPulse={{
      version: "series-club-pulse-v1",
      sourceMode: "server_aggregate",
      metrics: [{
        metricId: "entries_today",
        value: 21,
        unit: "count",
        availability: "exact",
        privacyState: "safe",
        asOf: "2026-08-09T12:34:56.789Z",
        sourceId: "tournaments.tournament_registrations",
        grain: "club_event_start_local_calendar_day",
        definitionVersion: "club-entries-event-day-v1",
      }],
    }} />);

    expect(await screen.findByText("Club Pulse server · Gemini")).toBeInTheDocument();
    expect(screen.queryByLabelText("Club Pulse minh họa")).toBeNull();
    expect(screen.queryByText("342")).toBeNull();
    expect(screen.getByText(/V sẽ đọc Club Pulse/)).toBeInTheDocument();
    expect(screen.queryByText("Sức khỏe lịch")).toBeNull();
  });

  it("renders the server-returned context and pinned model receipt after a live request", async () => {
    const serverContext = await createMockSeriesCopilotContextV1();
    const ask = vi.fn(async () => ({
      ...(await askMockSeriesCopilotV1({ untrustedQuestion: "Đánh giá lịch", context: serverContext, latencyMs: 0 })),
      receipt: { modelId: "gemini-3.6-flash" },
    }));
    render(<VCopilotPanel
      contextMode="live"
      clubId="11111111-1111-4111-8111-111111111111"
      clubPulse={{ version: "series-club-pulse-v1", sourceMode: "server_aggregate", metrics: [] }}
      ask={ask}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Hỏi V" }));
    expect(await screen.findByTestId("v-response")).toBeInTheDocument();
    expect(screen.getByText("Sức khỏe lịch")).toBeInTheDocument();
    expect(screen.getByText("gemini-3.6-flash")).toBeInTheDocument();
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({
      clubId: "11111111-1111-4111-8111-111111111111",
      context: null,
    }));
  });

  it("fails closed when live mode has no Club Pulse", async () => {
    render(<VCopilotPanel contextMode="live" clubPulse={null} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Chưa có Club Pulse đủ điều kiện để V sử dụng.");
    expect(screen.getByRole("button", { name: "Hỏi V" })).toBeDisabled();
  });
});
