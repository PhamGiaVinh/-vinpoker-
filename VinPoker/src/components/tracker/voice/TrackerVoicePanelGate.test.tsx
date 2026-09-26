import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StandaloneHandInput } from "@/components/cashier/tournament-live/handinput/useStandaloneHandInput";
import type { TrackerVoiceRuntimeContext } from "@/lib/trackerVoice";
import { isTrackerVoiceUiEnabled } from "@/lib/trackerVoice/uiGate";

const loadRuntime = vi.fn();

vi.mock("@/lib/trackerVoice", () => ({
  loadTrackerVoiceRuntimeContext: (...args: unknown[]) => loadRuntime(...args),
}));
vi.mock("./TrackerVoicePanel", () => ({
  TrackerVoicePanel: () => <p>Voice panel ready</p>,
}));

import { TrackerVoicePanelGate } from "./TrackerVoicePanelGate";

function runtimeFixture(overrides: Partial<TrackerVoiceRuntimeContext> = {}): TrackerVoiceRuntimeContext {
  return {
    ok: true,
    can_mint_session: true,
    read_only: false,
    correction_pending: false,
    config: {
      enabled: true,
      configured_mode: "shadow",
      provider_model: "gemini-3.1-flash-live-preview",
      spoken_amount_unit: 1,
      amount_unit_confirmed: false,
      provider_confidence_threshold: null,
      server_auto_allowed: false,
      correction_state: "ready",
    },
    active_hand: null,
    ...overrides,
  };
}

function hookFixture(tournamentTableId = "table-1"): StandaloneHandInput {
  return {
    tournamentId: "tournament-1",
    tournamentTableId,
  } as unknown as StandaloneHandInput;
}

afterEach(cleanup);
beforeEach(() => loadRuntime.mockReset());

describe("isTrackerVoiceUiEnabled", () => {
  it("only opens the Voice surface for a server-enabled writable assignment", () => {
    expect(isTrackerVoiceUiEnabled(runtimeFixture())).toBe(true);
    expect(isTrackerVoiceUiEnabled(runtimeFixture({ read_only: true }))).toBe(false);
    expect(isTrackerVoiceUiEnabled(runtimeFixture({ ok: false }))).toBe(false);
  });

  it("keeps disabled and malformed server contexts hidden", () => {
    expect(isTrackerVoiceUiEnabled(runtimeFixture({
      config: { ...runtimeFixture().config, enabled: false },
    }))).toBe(false);
    expect(isTrackerVoiceUiEnabled(null)).toBe(false);
  });
});

describe("TrackerVoicePanelGate", () => {
  it("shows a safe assignment reason and retries into the Voice panel", async () => {
    loadRuntime
      .mockRejectedValueOnce(new Error("dealer_assignment_missing"))
      .mockResolvedValueOnce(runtimeFixture());

    render(<TrackerVoicePanelGate hook={hookFixture()} compact />);

    expect(await screen.findByText("Tài khoản này không phải Dealer đang được phân công cho bàn.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText("Voice panel ready")).toBeTruthy();
    expect(loadRuntime).toHaveBeenCalledTimes(2);
  });

  it("ignores a late response from the previous table context", async () => {
    let resolveFirst: ((value: TrackerVoiceRuntimeContext) => void) | undefined;
    loadRuntime
      .mockImplementationOnce(() => new Promise<TrackerVoiceRuntimeContext>((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValueOnce(runtimeFixture());

    const { rerender } = render(<TrackerVoicePanelGate hook={hookFixture("table-1")} />);
    rerender(<TrackerVoicePanelGate hook={hookFixture("table-2")} />);

    expect(await screen.findByText("Voice panel ready")).toBeTruthy();
    resolveFirst?.(runtimeFixture({ read_only: true }));

    await waitFor(() => {
      expect(screen.getByText("Voice panel ready")).toBeTruthy();
    });
    expect(loadRuntime).toHaveBeenNthCalledWith(1, "tournament-1", "table-1");
    expect(loadRuntime).toHaveBeenNthCalledWith(2, "tournament-1", "table-2");
  });

  it("refreshes on focus without polling", async () => {
    loadRuntime
      .mockRejectedValueOnce(new Error("voice_config_stale"))
      .mockResolvedValueOnce(runtimeFixture());

    render(<TrackerVoicePanelGate hook={hookFixture()} />);
    expect(await screen.findByText("Voice chưa được duyệt cho đúng phiên Tracker hiện tại.")).toBeTruthy();

    fireEvent.focus(window);
    expect(await screen.findByText("Voice panel ready")).toBeTruthy();
    expect(loadRuntime).toHaveBeenCalledTimes(2);
  });
});
