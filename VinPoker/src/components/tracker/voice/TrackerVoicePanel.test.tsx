import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  MockRealtimeTranscriptionProvider,
  type TrackerVoiceRuntimeContext,
  type ValidatedVoiceEventReceipt,
} from "@/lib/trackerVoice";
import type { StandaloneHandInput } from "@/components/cashier/tournament-live/handinput/useStandaloneHandInput";
import { TrackerVoicePanel } from "./TrackerVoicePanel";
import type { TrackerVoiceDiagnosticSnapshot } from "./TrackerVoicePanel";

function hookFixture(): StandaloneHandInput {
  return {
    tournamentId: "tournament-1",
    tableId: "physical-table-1",
    tournamentTableId: "canonical-table-1",
    handId: "hand-1",
    currentStreet: "flop",
    workflowState: "flop_action",
    actorPlayer: {
    player_id: "player-a",
    display_name: "Player A",
    seat_number: 3,
    entry_number: 1,
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
  it("lets an explicit UAT runtime and provider reach the microphone permission seam", async () => {
    const hook = hookFixture() as StandaloneHandInput & { tournamentTableId?: string };
    delete hook.tournamentTableId;
    renderPanel(hook, new MockRealtimeTranscriptionProvider());

    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));

    expect(await screen.findByText("Microphone đã kết nối")).toBeInTheDocument();
    expect(screen.queryByText(/canonical cho Voice/)).not.toBeInTheDocument();
  });

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
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");
    act(() => provider.emit("raise", { final: false, id: "partial" }));
    expect(screen.queryByText(/Player A · raise/)).not.toBeInTheDocument();
    act(() => provider.emit("raise 6k", { final: true, id: "final" }));
    expect(await screen.findByText("Player A · raise tới 6.000")).toBeInTheDocument();
    expect(await screen.findByText("Shadow hợp lệ, không gọi server và chưa ghi action.")).toBeInTheDocument();
    expect(validateEventOverride).not.toHaveBeenCalled();
    expect(screen.getByText(/Auto bị khóa/)).toBeInTheDocument();
  });

  it("joins one VAD-split Raise prefix with the immediately following amount final", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const snapshots: TrackerVoiceDiagnosticSnapshot[] = [];
    const hook = {
      ...hookFixture(),
      actorPlayer: {
        ...hookFixture().actorPlayer,
        current_stack: 2_000_000,
      },
      actorViewData: {
        ...hookFixture().actorViewData,
        minRaiseTo: 4_000,
      },
    } as StandaloneHandInput;
    render(
      <TrackerVoicePanel
        hook={hook}
        providerOverride={provider}
        runtimeOverride={runtimeFixture}
        onDiagnosticSnapshot={(snapshot) => snapshots.push(snapshot)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");
    act(() => provider.emit("seat three raise", { final: true, id: "raise-prefix" }));
    expect(await screen.findByText("Đã nhận lệnh Raise/Bet, đang chờ số chip.")).toBeInTheDocument();
    expect(screen.queryByText(/Player A · raise tới/)).not.toBeInTheDocument();

    act(() => provider.emit("1 triệu 750 nghìn", { final: true, id: "raise-amount" }));
    expect(await screen.findByText("Player A · raise tới 1.750.000")).toBeInTheDocument();
    expect(snapshots.some((snapshot) => (
      snapshot.finalTranscript === "seat three raise 1 triệu 750 nghìn"
      && snapshot.proposal?.ok
    ))).toBe(true);
  });

  it("keeps an amount-only final fail-closed without an immediately preceding action prefix", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    renderPanel(hookFixture(), provider);

    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");
    act(() => provider.emit("1 triệu 750 nghìn", { final: true, id: "amount-only" }));

    expect(await screen.findByText("Chưa nhận ra một lệnh Voice duy nhất.")).toBeInTheDocument();
    expect(screen.queryByText(/Player A · raise tới/)).not.toBeInTheDocument();
  });

  it("keeps a Board transcript as a draft until the Dealer confirms one atomic receipt", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const applyVoiceBoardReceipt = vi.fn(() => true);
    const commitBoardOverride = vi.fn(async () => ({
      ok: true as const,
      voice_event_id: "voice-board-1",
      canonical_receipt_event_id: "board-receipt-1",
      idempotency_key: "voice:request-1",
      trace_id: "voice-trace:request-1",
      street: "flop" as const,
      previous_board: [],
      community_cards: ["Ah", "5s", "2d"],
      state_version_before: "a".repeat(64),
      state_version_after: "b".repeat(64),
    }));
    const validateEventOverride = vi.fn(async () => ({
      ...validatedReceipt,
      execution_mode: "assist" as const,
      voice_event_id: "voice-board-1",
    }));
    const hook = {
      ...hookFixture(),
      currentStreet: "flop",
      workflowState: "enter_flop",
      showActionStep: false,
      persistedBoardCount: 0,
      communityCards: [null, null, null, null, null],
      applyVoiceBoardReceipt,
    } as StandaloneHandInput;
    render(
      <TrackerVoicePanel
        hook={hook}
        providerOverride={provider}
        runtimeOverride={runtimeFixture}
        validateEventOverride={validateEventOverride}
        commitBoardOverride={commitBoardOverride}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "assist" }));
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");
    act(() => provider.emit("Flop ace hearts five spades two diamonds", { final: true, id: "board-final" }));

    expect(await screen.findByText("CẦN CHẠM XÁC NHẬN · CHƯA GHI BOARD")).toBeInTheDocument();
    expect(applyVoiceBoardReceipt).not.toHaveBeenCalled();
    expect(commitBoardOverride).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Xác nhận Flop" }));
    await waitFor(() => expect(commitBoardOverride).toHaveBeenCalledOnce());
    expect(commitBoardOverride.mock.calls[0][0].canonicalRequest).toMatchObject({
      intentDomain: "board",
      payload: { cumulativeCards: ["Ah", "5s", "2d"], expectedExistingBoardCount: 0 },
    });
    expect(applyVoiceBoardReceipt).toHaveBeenCalledOnce();
  });

  it("keeps Hole Cards speech outside generic diagnostics until the Dealer confirms", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const applyVoiceHoleCardsReceipt = vi.fn(() => true);
    const commitHoleCardsOverride = vi.fn(async () => ({
      ok: true as const,
      voice_event_id: "voice-hole-8",
      canonical_receipt_event_id: "hole-receipt-8",
      idempotency_key: "voice:hole-8",
      trace_id: "voice-trace:hole-8",
      seat_number: 8,
      player_id: "player-eight",
      entry_number: 2,
      redacted: true as const,
      state_version_before: "a".repeat(64),
      state_version_after: "b".repeat(64),
    }));
    const snapshots: TrackerVoiceDiagnosticSnapshot[] = [];
    const hook = {
      ...hookFixture(),
      workflowState: "runout_reveal",
      showActionStep: false,
      players: [
        { player_id: "player-eight", display_name: "Player Eight", seat_number: 8, entry_number: 2 },
        { player_id: "player-nine", display_name: "Player Nine", seat_number: 9, entry_number: 1 },
      ],
      playerHoleCards: {},
      applyVoiceHoleCardsReceipt,
    } as unknown as StandaloneHandInput;
    render(
      <TrackerVoicePanel
        hook={hook}
        providerOverride={provider}
        runtimeOverride={runtimeFixture}
        commitHoleCardsOverride={commitHoleCardsOverride}
        onDiagnosticSnapshot={(snapshot) => snapshots.push(snapshot)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "assist" }));
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");
    act(() => provider.emit("Seat 8 ace hearts ace spades", { final: true, id: "private-hole-8" }));

    expect(await screen.findByTestId("voice-private-hole-cards-proposal")).toBeInTheDocument();
    expect(screen.getByText("A♥")).toBeInTheDocument();
    expect(screen.getByText("A♠")).toBeInTheDocument();
    expect(screen.queryByText("Seat 8 ace hearts ace spades")).not.toBeInTheDocument();
    expect(snapshots.some((snapshot) => (
      snapshot.finalTranscript === "Seat 8 ace hearts ace spades"
      || JSON.stringify(snapshot.proposal).includes("ace hearts")
    ))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Xác nhận bài Ghế 8" }));
    await waitFor(() => expect(commitHoleCardsOverride).toHaveBeenCalledOnce());
    expect(commitHoleCardsOverride.mock.calls[0][0]).toMatchObject({
      finalTranscript: "Seat 8 ace hearts ace spades",
      canonicalRequest: {
        intentDomain: "hole_cards",
        payload: { seatNumber: 8, expectedPlayerId: "player-eight", expectedEntryNumber: 2, cards: ["Ah", "As"] },
      },
    });
    expect(applyVoiceHoleCardsReceipt).toHaveBeenCalledWith(expect.objectContaining({
      playerId: "player-eight",
      entryNumber: 2,
      cards: ["Ah", "As"],
    }));
    expect(await screen.findByText("Đã xác nhận bài Ghế 8")).toBeInTheDocument();
    expect(screen.queryByTestId("voice-private-hole-cards-proposal")).not.toBeInTheDocument();
  });

  it("keeps Finish as a server summary until one Dealer touch confirms it", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const runtime: TrackerVoiceRuntimeContext = {
      ...runtimeFixture,
      active_hand: { ...runtimeFixture.active_hand },
    };
    const applyVoiceFinishReceipt = vi.fn(async () => true);
    const prepareFinishOverride = vi.fn(async () => ({
      ok: true as const,
      settlement_origin: "engine_showdown" as const,
      settlement_digest: "b".repeat(64),
      state_version: "a".repeat(64),
      summary: {
        winners: [{ player_id: "player-a", seat_number: 3, player_name: "Player A", amount: 20_000 }],
        pots: [{ kind: "main" as const, amount: 20_000, winner_ids: ["player-a"] }],
        ending_stacks: [{ player_id: "player-a", seat_number: 3, amount: 20_000 }],
        conservation_total: 20_000,
      },
    }));
    const commitFinishOverride = vi.fn(async () => {
      runtime.active_hand = null;
      return {
        ok: true as const,
        voice_event_id: "voice-finish-1",
        canonical_receipt_event_id: "finish-receipt-1",
        idempotency_key: "voice:finish-1",
        trace_id: "voice-trace:finish-1",
        settlement_origin: "engine_showdown" as const,
        settlement_digest: "b".repeat(64),
        state_version_before: "a".repeat(64),
        state_version_after: "c".repeat(64),
        hand_id: "hand-1",
      };
    });
    const hook = {
      ...hookFixture(),
      currentStreet: "showdown",
      workflowState: "submit_ready",
      showActionStep: false,
      applyVoiceFinishReceipt,
    } as StandaloneHandInput;
    render(
      <TrackerVoicePanel
        hook={hook}
        providerOverride={provider}
        runtimeOverride={runtime}
        prepareFinishOverride={prepareFinishOverride}
        commitFinishOverride={commitFinishOverride}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "assist" }));
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");
    act(() => provider.emit("kết thúc hand", { final: true, id: "finish-final" }));

    expect(await screen.findByTestId("voice-finish-proposal")).toBeInTheDocument();
    expect(screen.getByText("CHƯA LƯU HAND")).toBeInTheDocument();
    expect(screen.getByText(/Ending stack: Ghế 3 20\.000/)).toBeInTheDocument();
    expect(commitFinishOverride).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "XÁC NHẬN LƯU HAND" }));
    await waitFor(() => expect(commitFinishOverride).toHaveBeenCalledOnce());
    expect(commitFinishOverride.mock.calls[0][0].canonicalRequest).toMatchObject({
      intentDomain: "finish_hand",
      payload: { settlementOrigin: "engine_showdown", settlementDigest: "b".repeat(64) },
    });
    expect(applyVoiceFinishReceipt).toHaveBeenCalledWith(expect.objectContaining({ hand_id: "hand-1" }));
  });

  it("keys each diagnostic proposal to its own final transcript", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const snapshots: TrackerVoiceDiagnosticSnapshot[] = [];
    render(
      <TrackerVoicePanel
        hook={hookFixture()}
        providerOverride={provider}
        runtimeOverride={runtimeFixture}
        validateEventOverride={vi.fn(async () => validatedReceipt)}
        onDiagnosticSnapshot={(snapshot) => snapshots.push(snapshot)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");

    act(() => provider.emit("fold", { final: true, id: "final-fold" }));
    await waitFor(() => expect(snapshots.some((snapshot) => (
      snapshot.finalProviderEventId === "final-fold"
      && snapshot.proposalProviderEventId === "final-fold"
      && snapshot.proposal?.command?.kind === "fold"
    ))).toBe(true));

    act(() => provider.emit("seat number five call", { final: true, id: "final-seat-five" }));
    await waitFor(() => expect(snapshots.some((snapshot) => (
      snapshot.finalProviderEventId === "final-seat-five"
      && snapshot.proposalProviderEventId === "final-seat-five"
      && snapshot.proposal?.command?.kind === "call"
    ))).toBe(true));

    expect(snapshots.some((snapshot) => (
      snapshot.finalProviderEventId === "final-seat-five"
      && snapshot.proposalProviderEventId === "final-fold"
    ))).toBe(false);
    expect(await screen.findByText("Đang tới Ghế 3, nhưng Voice nghe Ghế 5.")).toBeInTheDocument();
  });

  it("fails closed when the actor changes before proposal validation", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const hook = hookFixture();
    const { view } = renderPanel(hook, provider);
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");
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
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await waitFor(() => expect(screen.getByText("Microphone đã kết nối")).toBeInTheDocument());
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("pauses a capable provider without treating its final-transcript flush as a disconnect", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const pause = vi.spyOn(provider, "pause");
    const disconnect = vi.spyOn(provider, "disconnect");
    renderPanel(hookFixture(), provider);
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");

    fireEvent.click(screen.getByRole("button", { name: "Tạm dừng Voice" }));

    expect(await screen.findByText("Voice đã tạm dừng an toàn")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tiếp tục Voice" })).toBeInTheDocument();
    expect(pause).toHaveBeenCalledOnce();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("commits an Assist proposal once through the canonical hook", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const handleVoiceAction = vi.fn(async () => true);
    const hook = { ...hookFixture(), handleVoiceAction };
    const receipt = { ...validatedReceipt, execution_mode: "assist" as const };
    const validateEventOverride = vi.fn(async () => receipt);
    renderPanel(hook, provider, validateEventOverride);
    fireEvent.click(screen.getByRole("button", { name: "assist" }));
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");
    act(() => provider.emit("call", { final: true, id: "assist-final" }));
    const confirm = await screen.findByRole("button", { name: "Xác nhận action" });
    fireEvent.click(confirm);
    expect(await screen.findByText(/Canonical receipt đã được Viewer\/Replay nhận/)).toBeInTheDocument();
    expect(handleVoiceAction).toHaveBeenCalledOnce();
    expect(handleVoiceAction.mock.calls[0][1]).toMatchObject({
      source: "voice",
      tournamentTableId: "canonical-table-1",
      voiceEventId: "voice-event-1",
      expectedStateVersion: "a".repeat(64),
    });
    expect(validateEventOverride.mock.calls[0][0].canonicalRequest).toMatchObject({
      intentDomain: "action",
      payload: {
        canonicalAction: "call",
        actorPlayerId: "player-a",
        entryNumber: 1,
        seatNumber: 3,
      },
    });
  });

  it("single-flights two rapid Assist confirmations", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    let resolveCommit: ((value: boolean) => void) | null = null;
    const handleVoiceAction = vi.fn(() => new Promise<boolean>((resolve) => {
      resolveCommit = resolve;
    }));
    const hook = { ...hookFixture(), handleVoiceAction };
    renderPanel(hook, provider, vi.fn(async () => ({ ...validatedReceipt, execution_mode: "assist" as const })));
    fireEvent.click(screen.getByRole("button", { name: "assist" }));
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");
    act(() => provider.emit("call", { final: true, id: "assist-race" }));
    const confirm = await screen.findByRole("button", { name: "Xác nhận action" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(handleVoiceAction).toHaveBeenCalledOnce();
    resolveCommit?.(true);
    expect(await screen.findByText(/Canonical receipt đã được Viewer\/Replay nhận/)).toBeInTheDocument();
  });

  it("deduplicates duplicate provider completion callbacks", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const validateEventOverride = vi.fn(async () => validatedReceipt);
    renderPanel(hookFixture(), provider, validateEventOverride);
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");
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
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");

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
    expect(await screen.findByText(/Canonical receipt đã được Viewer\/Replay nhận/)).toBeInTheDocument();
    expect(handleVoiceAction).toHaveBeenCalledOnce();
  });

  it("shows the live RMS meter and enables the bounded iPad mic test", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    renderPanel(hookFixture(), provider);
    expect(screen.getByRole("button", { name: "Kiểm tra mic 30 giây" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");
    act(() => provider.emitLevel(0.4));
    expect(screen.getByRole("meter", { name: "Mức tín hiệu microphone" })).toHaveAttribute("aria-valuenow", "40");
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra mic 30 giây" }));
    expect(screen.getByRole("button", { name: /Đang test 30s/ })).toBeDisabled();
    expect(screen.getByText("30s")).toBeInTheDocument();
  });

  it("routes manual Floor alerts through validation without recording a poker action", async () => {
    const validateEventOverride = vi.fn(async () => ({
      ...validatedReceipt,
      execution_result: "alert_opened" as const,
      correction_pending: true,
      alert_id: "floor-alert-1",
    }));
    const handleVoiceAction = vi.fn(async () => true);
    renderPanel({ ...hookFixture(), handleVoiceAction }, new MockRealtimeTranscriptionProvider(), validateEventOverride);

    fireEvent.click(screen.getByRole("button", { name: "Báo sai action" }));
    expect(await screen.findByText("Alert đã vào hàng đợi Floor.")).toBeInTheDocument();
    expect(validateEventOverride).toHaveBeenCalledOnce();
    expect(validateEventOverride.mock.calls[0][0]).toMatchObject({
      finalTranscript: "báo sai action",
      executionMode: "shadow",
    });
    expect(handleVoiceAction).not.toHaveBeenCalled();
  });

  it("keeps fallback controls on the existing manual action handler", () => {
    const handleDockAction = vi.fn();
    renderPanel({ ...hookFixture(), handleDockAction });

    fireEvent.click(screen.getByRole("button", { name: "Call" }));
    expect(handleDockAction).toHaveBeenCalledWith("call", undefined);
  });
});
