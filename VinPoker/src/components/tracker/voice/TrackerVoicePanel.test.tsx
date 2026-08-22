import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  MockRealtimeTranscriptionProvider,
  type TrackerVoiceRuntimeContext,
  type ValidatedVoiceEventReceipt,
} from "@/lib/trackerVoice";
import type { StandaloneHandInput } from "@/components/cashier/tournament-live/handinput/useStandaloneHandInput";
import { TrackerVoicePanel } from "./TrackerVoicePanel";

function hookFixture(): StandaloneHandInput {
  return {
    tournamentId: "tournament-1",
    tableId: "table-1",
    handId: "hand-1",
    currentStreet: "flop",
    actorPlayer: {
      player_id: "player-a",
      display_name: "Player A",
      seat_number: 3,
      current_stack: 10_000,
      current_bet: 1_000,
    },
    actorViewData: {
      toCall: 1_000,
      minRaiseTo: 4_000,
      legal: { fold: true, check: false, call: true, bet: false, raise: true, allIn: true },
    },
    handStarted: true,
    showActionStep: true,
    isReadOnly: false,
    actionSyncBlocked: false,
  } as unknown as StandaloneHandInput;
}

const runtimeFixture: TrackerVoiceRuntimeContext = {
  ok: true,
  can_mint_session: true,
  read_only: false,
  correction_pending: false,
  config: {
    enabled: true,
    configured_mode: "assist",
    provider_model: "gpt-live-transcribe",
    spoken_amount_unit: 1,
    amount_unit_confirmed: false,
    provider_confidence_threshold: null,
    server_auto_allowed: false,
    correction_state: "ready",
  },
  active_hand: {
    hand_id: "hand-1",
    hand_number: 1,
    status: "in_progress",
    state_version: "a".repeat(64),
  },
};

const validatedReceipt: ValidatedVoiceEventReceipt = {
  ok: true,
  voice_event_id: "voice-event-1",
  idempotency_key: "voice:request-1",
  trace_id: "voice-trace:request-1",
  state_version: "a".repeat(64),
  execution_mode: "shadow",
  execution_result: "validated",
  correction_pending: false,
  alert_id: null,
};

const renderPanel = (
  hook = hookFixture(),
  provider = new MockRealtimeTranscriptionProvider(),
  validateEventOverride = vi.fn(async () => validatedReceipt),
) => ({
  provider,
  validateEventOverride,
  view: render(
    <TrackerVoicePanel
      hook={hook}
      providerOverride={provider}
      runtimeOverride={runtimeFixture}
      validateEventOverride={validateEventOverride}
    />,
  ),
});

describe("TrackerVoicePanel", () => {
  it("turns only a final transcript into a Shadow proposal", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const validateEventOverride = vi.fn(async () => validatedReceipt);
    render(
      <TrackerVoicePanel
        hook={hookFixture()}
        providerOverride={provider}
        runtimeOverride={runtimeFixture}
        validateEventOverride={validateEventOverride}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Kết nối mic" }));
    await screen.findByText("Đang nghe");
    act(() => provider.emit("raise", { final: false, id: "partial" }));
    expect(screen.queryByText(/Player A · raise/)).not.toBeInTheDocument();
    act(() => provider.emit("raise 6k", { final: true, id: "final" }));
    expect(await screen.findByText("Player A · raise tới 6.000")).toBeInTheDocument();
    expect(await screen.findByText("Shadow hợp lệ, không gọi server và chưa ghi action.")).toBeInTheDocument();
    expect(validateEventOverride).not.toHaveBeenCalled();
    expect(screen.getByText(/Auto bị khóa/)).toBeInTheDocument();
  });

  it("fails closed when the actor changes before proposal validation", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const hook = hookFixture();
    const { view } = renderPanel(hook, provider);
    fireEvent.click(screen.getByRole("button", { name: "Kết nối mic" }));
    await screen.findByText("Đang nghe");
    view.rerender(
      <TrackerVoicePanel
        hook={{ ...hook, actorPlayer: null, actorViewData: null }}
        providerOverride={provider}
        runtimeOverride={runtimeFixture}
        validateEventOverride={vi.fn(async () => validatedReceipt)}
      />,
    );
    act(() => provider.emit("call", { final: true }));
    expect(await screen.findByText("Chưa xác định được người đang tới lượt.")).toBeInTheDocument();
  });

  it("disconnects the provider on unmount", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const disconnect = vi.spyOn(provider, "disconnect");
    const { view } = renderPanel(hookFixture(), provider);
    fireEvent.click(screen.getByRole("button", { name: "Kết nối mic" }));
    await waitFor(() => expect(screen.getByText("Đang nghe")).toBeInTheDocument());
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("commits an Assist proposal once through the canonical hook", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const handleVoiceAction = vi.fn(async () => true);
    const hook = { ...hookFixture(), handleVoiceAction };
    const receipt = { ...validatedReceipt, execution_mode: "assist" as const };
    const validateEventOverride = vi.fn(async () => receipt);
    renderPanel(hook, provider, validateEventOverride);
    fireEvent.click(screen.getByRole("button", { name: "assist" }));
    fireEvent.click(screen.getByRole("button", { name: "Kết nối mic" }));
    await screen.findByText("Đang nghe");
    act(() => provider.emit("call", { final: true, id: "assist-final" }));
    const confirm = await screen.findByRole("button", { name: "Xác nhận action" });
    fireEvent.click(confirm);
    expect(await screen.findByText(/Action đã được Viewer\/Replay nhận/)).toBeInTheDocument();
    expect(handleVoiceAction).toHaveBeenCalledOnce();
    expect(handleVoiceAction.mock.calls[0][1]).toMatchObject({
      source: "voice",
      tournamentTableId: "table-1",
      voiceEventId: "voice-event-1",
      expectedStateVersion: "a".repeat(64),
    });
  });

  it("deduplicates duplicate provider completion callbacks", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const validateEventOverride = vi.fn(async () => validatedReceipt);
    renderPanel(hookFixture(), provider, validateEventOverride);
    fireEvent.click(screen.getByRole("button", { name: "Kết nối mic" }));
    await screen.findByText("Đang nghe");
    act(() => {
      provider.emit("call", { final: true, id: "same-provider-item" });
      provider.emit("call", { final: true, id: "same-provider-item" });
    });
    await screen.findByText("Shadow hợp lệ, không gọi server và chưa ghi action.");
    expect(validateEventOverride).not.toHaveBeenCalled();
  });

  it("buffers during correction and revalidates in Assist after Floor resolves", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const handleVoiceAction = vi.fn(async () => true);
    const hook = { ...hookFixture(), handleVoiceAction };
    const validateEventOverride = vi.fn(async (input) => {
      if (input.finalTranscript.includes("sai")) {
        return {
          ...validatedReceipt,
          execution_result: "alert_opened" as const,
          correction_pending: true,
          alert_id: "floor-alert-1",
        };
      }
      return {
        ...validatedReceipt,
        voice_event_id: "voice-event-buffered",
        execution_mode: "assist" as const,
      };
    });
    renderPanel(hook, provider, validateEventOverride);
    fireEvent.click(screen.getByRole("button", { name: "Kết nối mic" }));
    await screen.findByText("Đang nghe");

    act(() => provider.emit("báo sai action", { final: true, id: "wrong-action" }));
    expect(await screen.findByText("Alert đã vào hàng đợi Floor.")).toBeInTheDocument();

    act(() => provider.emit("call", { final: true, id: "buffered-call" }));
    expect(await screen.findByText("1 transcript đang chờ Floor")).toBeInTheDocument();
    expect(validateEventOverride).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra lại sau khi Floor sửa" }));
    const confirm = await screen.findByRole("button", { name: "Xác nhận action" });
    expect(validateEventOverride).toHaveBeenCalledTimes(2);
    expect(validateEventOverride.mock.calls[1][0]).toMatchObject({
      finalTranscript: "call",
      executionMode: "assist",
    });
    fireEvent.click(confirm);
    expect(await screen.findByText(/Action đã được Viewer\/Replay nhận/)).toBeInTheDocument();
    expect(handleVoiceAction).toHaveBeenCalledOnce();
  });

  it("shows the live RMS meter and enables the bounded iPad mic test", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    renderPanel(hookFixture(), provider);
    expect(screen.getByRole("button", { name: "Kiểm tra mic 30 giây" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Kết nối mic" }));
    await screen.findByText("Đang nghe");
    act(() => provider.emitLevel(0.4));
    expect(screen.getByRole("meter", { name: "Mức tín hiệu microphone" })).toHaveAttribute("aria-valuenow", "40");
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra mic 30 giây" }));
    expect(screen.getByRole("button", { name: /Đang test 30s/ })).toBeDisabled();
  });
});
