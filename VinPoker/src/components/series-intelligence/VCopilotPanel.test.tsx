import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askMockSeriesCopilotV1, type MockSeriesCopilotRequestV1 } from "@/lib/series-intelligence/seriesCopilotMockAdapter";
import { VCopilotPanel } from "./VCopilotPanel";

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
    const ask = vi.fn(async (request: MockSeriesCopilotRequestV1) => {
      await gate;
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
});
